import { Controller, Get, Header, Req } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedRequest } from '../identity/auth.types.js';
import { CreditBillingService } from './credit-billing.service.js';

@Controller('usage')
export class UsageController {
  public constructor(
    private readonly billing: CreditBillingService,
    private readonly database: PrismaService,
  ) {}

  @Get()
  @Header('cache-control', 'no-store')
  public async current(@Req() request: AuthenticatedRequest) {
    if (!request.authentication)
      throw new Error('Authentication guard did not run');
    const userId = request.authentication.user.id;
    await this.billing.ensureDailyFreeGrant(userId);
    const wallet = await this.database.client.creditWallet.findUniqueOrThrow({
      where: { userId },
    });
    const transactions = await this.database.client.creditTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      transactions: transactions.map((transaction) => ({
        ...transaction,
        amount: transaction.amount.toString(),
        availableDelta: transaction.availableDelta.toString(),
        reservedDelta: transaction.reservedDelta.toString(),
      })),
      wallet: {
        ...wallet,
        availableCredits: wallet.availableCredits.toString(),
        reservedCredits: wallet.reservedCredits.toString(),
      },
    };
  }
}
