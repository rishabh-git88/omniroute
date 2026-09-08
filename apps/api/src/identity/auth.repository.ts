import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type {
  ActiveSession,
  IdentityProfile,
  IdentityUser,
} from './auth.types.js';

const userWithWorkspace = {
  workspaces: {
    orderBy: { createdAt: 'asc' as const },
    take: 1,
    where: { deletedAt: null },
  },
};

function toIdentityUser(user: {
  email: string;
  id: string;
  name: string | null;
  status: IdentityUser['status'];
  workspaces: { id: string; name: string }[];
}): IdentityUser {
  const workspace = user.workspaces[0];
  if (!workspace) throw new Error('Authenticated user has no active workspace');

  return {
    email: user.email,
    id: user.id,
    name: user.name,
    status: user.status,
    workspace,
  };
}

@Injectable()
export class AuthRepository {
  public constructor(private readonly database: PrismaService) {}

  public async findOrCreateIdentity(
    profile: IdentityProfile,
  ): Promise<IdentityUser> {
    const email = profile.email.trim().toLowerCase();

    return this.database.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${profile.provider}:${profile.providerAccountId}`}, 0)
        )
      `;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))
      `;

      const account = await transaction.account.findUnique({
        where: {
          identityProvider_providerAccountId: {
            identityProvider: profile.provider,
            providerAccountId: profile.providerAccountId,
          },
        },
        include: { user: { include: userWithWorkspace } },
      });

      if (account) {
        await transaction.account.update({
          where: { id: account.id },
          data: { emailAtProvider: email, lastLoginAt: new Date() },
        });
        return toIdentityUser(account.user);
      }

      let user = await transaction.user.findUnique({
        where: { email },
        include: userWithWorkspace,
      });

      if (user) {
        await transaction.account.create({
          data: {
            emailAtProvider: email,
            identityProvider: profile.provider,
            lastLoginAt: new Date(),
            providerAccountId: profile.providerAccountId,
            userId: user.id,
          },
        });
      } else {
        user = await transaction.user.create({
          data: {
            email,
            name: profile.name,
            accounts: {
              create: {
                emailAtProvider: email,
                identityProvider: profile.provider,
                lastLoginAt: new Date(),
                providerAccountId: profile.providerAccountId,
              },
            },
            wallet: { create: {} },
            workspaces: {
              create: { name: `${profile.name ?? 'Personal'} workspace` },
            },
          },
          include: userWithWorkspace,
        });
      }

      return toIdentityUser(user);
    });
  }

  public async createSession(input: {
    expiresAt: Date;
    tokenHash: string;
    user: IdentityUser;
  }): Promise<string> {
    return this.database.client.$transaction(async (transaction) => {
      const session = await transaction.session.create({
        data: {
          expiresAt: input.expiresAt,
          lastSeenAt: new Date(),
          sessionTokenHash: input.tokenHash,
          userId: input.user.id,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: input.user.id,
          eventType: 'identity.login',
          metadata: { identityProvider: 'google' },
          resourceId: session.id,
          resourceType: 'session',
          workspaceId: input.user.workspace.id,
        },
      });
      return session.id;
    });
  }

  public async findActiveSession(
    tokenHash: string,
  ): Promise<ActiveSession | null> {
    const session = await this.database.client.session.findFirst({
      where: {
        expiresAt: { gt: new Date() },
        revokedAt: null,
        sessionTokenHash: tokenHash,
      },
      include: { user: { include: userWithWorkspace } },
    });
    if (!session) return null;

    return {
      ...toIdentityUser(session.user),
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      sessionId: session.id,
      tokenHash: session.sessionTokenHash,
    };
  }

  public async rotateSession(input: {
    currentHash: string;
    nextHash: string;
    sessionId: string;
  }): Promise<boolean> {
    const result = await this.database.client.session.updateMany({
      where: {
        expiresAt: { gt: new Date() },
        id: input.sessionId,
        revokedAt: null,
        sessionTokenHash: input.currentHash,
      },
      data: { lastSeenAt: new Date(), sessionTokenHash: input.nextHash },
    });
    return result.count === 1;
  }

  public async revokeSession(input: {
    sessionId: string;
    userId: string;
    workspaceId: string;
  }): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const result = await transaction.session.updateMany({
        where: { id: input.sessionId, revokedAt: null, userId: input.userId },
        data: { revokedAt: new Date() },
      });
      if (result.count === 0) return;

      await transaction.auditEvent.create({
        data: {
          actorUserId: input.userId,
          eventType: 'identity.logout',
          resourceId: input.sessionId,
          resourceType: 'session',
          workspaceId: input.workspaceId,
        },
      });
    });
  }
}
