import { Injectable } from '@nestjs/common';

import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface CreateUserInput {
  email: string;
  name?: string;
  identityProvider: string;
  providerAccountId: string;
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
}

@Injectable()
export class PrismaUserRepository implements UserRepository {
  public constructor(private readonly database: PrismaService) {}

  public async create(input: CreateUserInput): Promise<User> {
    const email = input.email.trim().toLowerCase();

    return this.database.client.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email,
          ...(input.name === undefined ? {} : { name: input.name }),
          accounts: {
            create: {
              identityProvider: input.identityProvider,
              providerAccountId: input.providerAccountId,
              emailAtProvider: email,
            },
          },
          wallet: { create: {} },
        },
      });

      await transaction.workspace.create({
        data: {
          name: `${input.name ?? 'Personal'} workspace`,
          ownerId: user.id,
        },
      });

      return user;
    });
  }

  public findByEmail(email: string): Promise<User | null> {
    return this.database.client.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }
}
