import { Router } from 'express';
import { authLimiter } from '../middleware/rateLimit';
import {
  ADMIN_ONLY,
  requireAuth,
  type AuthenticatedRequest,
} from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { authService } from '../services/auth.service';
import { auditService } from '../services/audit.service';
import { clientIp, ok } from '../utils/http';
import {
  createUserSchema,
  idParamSchema,
  loginSchema,
  updateUserSchema,
} from '../validators';

export const authRouter = Router();

/** POST /api/v1/auth/login — issues a JWT and records the sign-in. */
authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const result = await authService.login(email, password);
    await auditService.record(
      result.user,
      'LOGIN',
      'user',
      result.user._id,
      `${result.user.name} signed in`,
      clientIp(req),
    );
    return ok(res, result);
  }),
);

/** GET /api/v1/auth/me — used on app boot to rehydrate the session. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const user = await authService.findById(req.user!._id);
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account no longer exists' } });
    return ok(res, user);
  }),
);

/** POST /api/v1/auth/logout — stateless JWT, so this only writes an audit trail. */
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    await auditService.record(
      req.user!,
      'LOGOUT',
      'user',
      req.user!._id,
      'Session ended',
      clientIp(req),
    );
    return ok(res, { message: 'Signed out' });
  }),
);

/* ─────────────────────────── User administration ────────────────────────── */

export const userRouter = Router();

userRouter.use(requireAuth);

userRouter.get(
  '/',
  ADMIN_ONLY,
  asyncHandler(async (_req, res) => ok(res, await authService.listUsers())),
);

userRouter.post(
  '/',
  ADMIN_ONLY,
  validate({ body: createUserSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const created = await authService.createUser(req.body);
    await auditService.record(req.user!, 'CREATE', 'user', created._id, `Created ${created.email}`, clientIp(req));
    return ok(res, created, undefined, 201);
  }),
);

userRouter.patch(
  '/:id',
  ADMIN_ONLY,
  validate({ params: idParamSchema, body: updateUserSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const updated = await authService.updateUser(req.params.id, req.body);
    await auditService.record(req.user!, 'UPDATE', 'user', updated._id, `Updated ${updated.email}`, clientIp(req));
    return ok(res, updated);
  }),
);

userRouter.delete(
  '/:id',
  ADMIN_ONLY,
  validate({ params: idParamSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    await authService.deleteUser(req.params.id);
    await auditService.record(req.user!, 'DELETE', 'user', req.params.id, 'Account removed', clientIp(req));
    return ok(res, { deleted: true });
  }),
);
