import { Injectable } from '@nestjs/common';

import {
  CreditReservationStatus,
  CreditTransactionStatus,
  CreditTransactionType,
  Prisma,
  type CreditReservation,
  type CreditWallet,
  UsageEventKind,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

interface LockedWalletRow {
  id: string;
  user_id: string;
  available_credits: bigint;
  reserved_credits: bigint;
}

interface LockedReservationRow {
  id: string;
  wallet_id: string;
  request_group_id: string;
  model_run_id: string;
  reserved_credits: bigint;
  status: CreditReservationStatus;
}

export class InsufficientCreditsError extends Error {
  public constructor() {
    super('Insufficient available credits');
    this.name = 'InsufficientCreditsError';
  }
}

export interface ReserveCreditsInput {
  userId: string;
  requestGroupId: string;
  modelRunId: string;
  credits: bigint;
  idempotencyKey: string;
}

export interface ReconcileCreditsInput {
  reservationId: string;
  actualCredits: bigint;
  idempotencyKey: string;
  usage?: {
    actualCost: Prisma.Decimal | Prisma.DecimalJsLike | string;
    billedCredits: bigint;
    cachedTokens?: bigint;
    costCurrency: string;
    eventKey: string;
    inputTokens: bigint;
    outputTokens: bigint;
    priceSnapshot: Prisma.InputJsonValue;
    providerUsage: Prisma.InputJsonValue;
  };
}

@Injectable()
export class CreditLedgerRepository {
  public constructor(private readonly database: PrismaService) {}

  public async grant(
    userId: string,
    credits: bigint,
    idempotencyKey: string,
    reason?: string,
  ): Promise<CreditWallet> {
    this.assertPositive(credits);

    return this.database.client.$transaction(
      async (transaction) => {
        await transaction.creditWallet.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        const wallet = await this.lockWallet(transaction, userId);
        const existing = await transaction.creditTransaction.findUnique({
          where: {
            walletId_idempotencyKey: { walletId: wallet.id, idempotencyKey },
          },
        });
        if (existing)
          return transaction.creditWallet.findUniqueOrThrow({
            where: { id: wallet.id },
          });

        const updated = await transaction.creditWallet.update({
          where: { id: wallet.id },
          data: {
            availableCredits: { increment: credits },
            version: { increment: 1 },
          },
        });
        await transaction.creditTransaction.create({
          data: {
            walletId: wallet.id,
            userId,
            idempotencyKey,
            amount: credits,
            availableDelta: credits,
            reservedDelta: 0n,
            type: CreditTransactionType.GRANT,
            status: CreditTransactionStatus.COMPLETED,
            ...(reason === undefined ? {} : { reason }),
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async reserve(input: ReserveCreditsInput): Promise<CreditReservation> {
    this.assertPositive(input.credits);

    return this.database.client.$transaction(
      async (transaction) => {
        const wallet = await this.lockWallet(transaction, input.userId);
        const existing = await transaction.creditReservation.findUnique({
          where: {
            walletId_idempotencyKey: {
              walletId: wallet.id,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) return existing;
        if (wallet.available_credits < input.credits)
          throw new InsufficientCreditsError();

        const reservation = await transaction.creditReservation.create({
          data: {
            walletId: wallet.id,
            requestGroupId: input.requestGroupId,
            modelRunId: input.modelRunId,
            idempotencyKey: input.idempotencyKey,
            reservedCredits: input.credits,
          },
        });
        await transaction.creditWallet.update({
          where: { id: wallet.id },
          data: {
            availableCredits: { decrement: input.credits },
            reservedCredits: { increment: input.credits },
            version: { increment: 1 },
          },
        });
        await transaction.creditTransaction.create({
          data: {
            walletId: wallet.id,
            userId: input.userId,
            requestGroupId: input.requestGroupId,
            modelRunId: input.modelRunId,
            reservationId: reservation.id,
            idempotencyKey: `${input.idempotencyKey}:reserve`,
            amount: input.credits,
            availableDelta: -input.credits,
            reservedDelta: input.credits,
            type: CreditTransactionType.RESERVATION,
            status: CreditTransactionStatus.PENDING,
          },
        });
        await transaction.modelRun.update({
          where: { id: input.modelRunId },
          data: { status: 'RESERVED' },
        });
        return reservation;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async reconcile(input: ReconcileCreditsInput): Promise<CreditWallet> {
    if (input.actualCredits < 0n)
      throw new RangeError('Credits cannot be negative');

    return this.database.client.$transaction(
      async (transaction) => {
        const locator = await transaction.creditReservation.findUniqueOrThrow({
          where: { id: input.reservationId },
          select: { walletId: true },
        });
        const walletRows = await transaction.$queryRaw<
          LockedWalletRow[]
        >(Prisma.sql`
          SELECT id, user_id, available_credits, reserved_credits
          FROM credit_wallets
          WHERE id = ${locator.walletId}::uuid
          FOR UPDATE
        `);
        const wallet = walletRows[0];
        if (!wallet) throw new Error('Credit wallet not found');

        const rows = await transaction.$queryRaw<
          LockedReservationRow[]
        >(Prisma.sql`
          SELECT id, wallet_id, request_group_id, model_run_id, reserved_credits, status
          FROM credit_reservations
          WHERE id = ${input.reservationId}::uuid
          FOR UPDATE
        `);
        const reservation = rows[0];
        if (!reservation) throw new Error('Credit reservation not found');
        if (reservation.status !== CreditReservationStatus.PENDING)
          return transaction.creditWallet.findUniqueOrThrow({
            where: { id: wallet.id },
          });
        if (input.actualCredits > reservation.reserved_credits) {
          throw new Error('Actual credits exceed the reservation');
        }

        const released = reservation.reserved_credits - input.actualCredits;
        const isRelease = input.actualCredits === 0n;
        await transaction.creditWallet.update({
          where: { id: wallet.id },
          data: {
            availableCredits: { increment: released },
            reservedCredits: { decrement: reservation.reserved_credits },
            version: { increment: 1 },
          },
        });
        await transaction.creditReservation.update({
          where: { id: reservation.id },
          data: {
            status: isRelease
              ? CreditReservationStatus.RELEASED
              : CreditReservationStatus.SETTLED,
            settledCredits: input.actualCredits,
            reconciledAt: new Date(),
          },
        });
        if (input.usage) {
          await transaction.usageEvent.createMany({
            data: {
              runId: reservation.model_run_id,
              eventKey: input.usage.eventKey,
              kind: UsageEventKind.FINAL,
              inputTokens: input.usage.inputTokens,
              outputTokens: input.usage.outputTokens,
              cachedTokens: input.usage.cachedTokens ?? 0n,
              providerUsage: input.usage.providerUsage,
              priceSnapshot: input.usage.priceSnapshot,
              actualCost: input.usage.actualCost,
              costCurrency: input.usage.costCurrency,
              billedCredits: input.usage.billedCredits,
            },
            skipDuplicates: true,
          });
        }
        if (!isRelease) {
          await transaction.creditTransaction.create({
            data: {
              walletId: wallet.id,
              userId: wallet.user_id,
              requestGroupId: reservation.request_group_id,
              modelRunId: reservation.model_run_id,
              reservationId: reservation.id,
              idempotencyKey: `${input.idempotencyKey}:charge`,
              amount: input.actualCredits,
              availableDelta: 0n,
              reservedDelta: -input.actualCredits,
              type: CreditTransactionType.CHARGE,
              status: CreditTransactionStatus.COMPLETED,
            },
          });
        }
        if (released > 0n) {
          await transaction.creditTransaction.create({
            data: {
              walletId: wallet.id,
              userId: wallet.user_id,
              requestGroupId: reservation.request_group_id,
              modelRunId: reservation.model_run_id,
              reservationId: reservation.id,
              idempotencyKey: `${input.idempotencyKey}:release`,
              amount: released,
              availableDelta: released,
              reservedDelta: -released,
              type: CreditTransactionType.RELEASE,
              status: CreditTransactionStatus.COMPLETED,
            },
          });
        }

        return transaction.creditWallet.findUniqueOrThrow({
          where: { id: wallet.id },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async refund(
    userId: string,
    credits: bigint,
    idempotencyKey: string,
    reason: string,
  ): Promise<CreditWallet> {
    this.assertPositive(credits);

    return this.database.client.$transaction(
      async (transaction) => {
        const wallet = await this.lockWallet(transaction, userId);
        const existing = await transaction.creditTransaction.findUnique({
          where: {
            walletId_idempotencyKey: { walletId: wallet.id, idempotencyKey },
          },
        });
        if (existing)
          return transaction.creditWallet.findUniqueOrThrow({
            where: { id: wallet.id },
          });

        const updated = await transaction.creditWallet.update({
          where: { id: wallet.id },
          data: {
            availableCredits: { increment: credits },
            version: { increment: 1 },
          },
        });
        await transaction.creditTransaction.create({
          data: {
            walletId: wallet.id,
            userId,
            idempotencyKey,
            amount: credits,
            availableDelta: credits,
            reservedDelta: 0n,
            type: CreditTransactionType.REFUND,
            status: CreditTransactionStatus.COMPLETED,
            reason,
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async lockWallet(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<LockedWalletRow> {
    const rows = await transaction.$queryRaw<LockedWalletRow[]>(Prisma.sql`
      SELECT id, user_id, available_credits, reserved_credits
      FROM credit_wallets
      WHERE user_id = ${userId}::uuid
      FOR UPDATE
    `);
    const wallet = rows[0];
    if (!wallet) throw new Error('Credit wallet not found');
    return wallet;
  }

  private assertPositive(credits: bigint): void {
    if (credits <= 0n) throw new RangeError('Credits must be positive');
  }
}
