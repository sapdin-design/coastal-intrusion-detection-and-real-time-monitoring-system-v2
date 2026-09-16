import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getStore } from '../repositories';
import type { Actor, PublicUser, User, UserRole } from '../types/domain';
import { businessId, nowIso } from '../utils/ids';

export interface AuthTokenPayload extends Actor {
  /** Standard JWT subject claim, mirrors `_id`. */
  sub: string;
}

export interface LoginResult {
  token: string;
  expiresIn: string;
  user: PublicUser;
}

export const toPublicUser = (user: User): PublicUser => {
  const { passwordHash: _ignored, ...rest } = user;
  return rest;
};

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  active?: boolean;
}

export class AuthService {
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, env.bcryptRounds);
  }

  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  signToken(user: User): string {
    const payload: AuthTokenPayload = {
      sub: user._id,
      _id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
    };
    return jwt.sign(payload, env.jwt.secret, {
      expiresIn: env.jwt.expiresIn,
    } as SignOptions);
  }

  verifyToken(token: string): AuthTokenPayload {
    return jwt.verify(token, env.jwt.secret) as AuthTokenPayload;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const store = getStore();
    const user = await store.users.findByEmail(email);

    // Same generic message for unknown account and wrong password — no user enumeration.
    const invalid = Object.assign(new Error('Invalid email or password'), { status: 401 });
    if (!user) throw invalid;

    const ok = await this.verify(password, user.passwordHash);
    if (!ok) throw invalid;

    if (!user.active) {
      throw Object.assign(new Error('This account has been deactivated'), { status: 403 });
    }

    const updated = await store.users.update(user._id, { lastLoginAt: nowIso() });
    const token = this.signToken(user);
    logger.info(`user ${user.email} signed in as ${user.role}`);

    return { token, expiresIn: env.jwt.expiresIn, user: toPublicUser(updated ?? user) };
  }

  async findById(id: string): Promise<PublicUser | null> {
    const user = await getStore().users.findById(id);
    return user ? toPublicUser(user) : null;
  }

  async listUsers(): Promise<PublicUser[]> {
    const rows = await getStore().users.list();
    return rows.map(toPublicUser);
  }

  async createUser(input: CreateUserInput): Promise<PublicUser> {
    const store = getStore();
    const existing = await store.users.findByEmail(input.email);
    if (existing) {
      throw Object.assign(new Error('An account with that email already exists'), { status: 409 });
    }

    const at = nowIso();
    const user: User = {
      _id: businessId('user'),
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: await this.hash(input.password),
      role: input.role,
      active: input.active ?? true,
      lastLoginAt: null,
      createdAt: at,
      updatedAt: at,
    };

    const saved = await store.users.create(user);
    logger.info(`user ${saved.email} created with role ${saved.role}`);
    return toPublicUser(saved);
  }

  async updateUser(
    id: string,
    patch: { name?: string; role?: UserRole; active?: boolean; password?: string },
  ): Promise<PublicUser> {
    const store = getStore();
    const existing = await store.users.findById(id);
    if (!existing) throw Object.assign(new Error('User not found'), { status: 404 });

    const next: Partial<User> = {};
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.role !== undefined) next.role = patch.role;
    if (patch.active !== undefined) next.active = patch.active;
    if (patch.password) next.passwordHash = await this.hash(patch.password);

    const updated = await store.users.update(id, next);
    if (!updated) throw Object.assign(new Error('User not found'), { status: 404 });
    return toPublicUser(updated);
  }

  async deleteUser(id: string): Promise<void> {
    const store = getStore();
    const existing = await store.users.findById(id);
    if (!existing) throw Object.assign(new Error('User not found'), { status: 404 });
    const remaining = await store.users.count();
    if (remaining <= 1) {
      throw Object.assign(new Error('Cannot delete the last remaining account'), { status: 409 });
    }
    await store.users.remove(id);
  }

  /** Idempotent bootstrap used by `npm run seed` and by the first server boot. */
  async ensureDefaults(): Promise<void> {
    const store = getStore();
    const count = await store.users.count();
    if (count > 0) return;

    const defaults: CreateUserInput[] = [
      { name: 'Aarav Menon', email: 'admin@cidrtm.gov.in', password: 'Admin@123', role: 'ADMIN' },
      { name: 'Priya Nair', email: 'operator@cidrtm.gov.in', password: 'Operator@123', role: 'OPERATOR' },
      { name: 'Rahul Verma', email: 'analyst@cidrtm.gov.in', password: 'Analyst@123', role: 'ANALYST' },
    ];

    for (const user of defaults) await this.createUser(user);
    logger.info('default accounts created (admin / operator / analyst)');
  }
}

export const authService = new AuthService();
