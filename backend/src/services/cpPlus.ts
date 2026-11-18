import { Camera } from '../models';
import type { AuthContext } from '../types/auth';
import { AppError } from '../utils/errors';
import { createCamera, discoverLanPorts, startMonitoring } from './cameras.service';

export interface CpPlusInput {
  location: string;
  site?: string | null;
  samplingFps?: number;
  username: string;
  password: string;
  ips: string[];
}

/**
 * CP Plus auto-detect. The search returns each camera's own address. The website
 * login is stored with that camera, and monitoring is started.
 */
export async function addCpPlusCameras(ctx: AuthContext, input: CpPlusInput, ip: string | null) {
  const found = await discoverLanPorts();
  const wanted = found.cameras.filter((camera) => input.ips.includes(camera.ip));
  if (!wanted.length) {
    throw new AppError(400, 'NO_CP_PLUS_CAMERA', found.notice || 'No CP Plus camera answered. Auto detect again with the cable connected.');
  }

  const existing = await Camera.findAll({ where: { organizationId: ctx.organizationId }, attributes: ['streamReference'] });
  const known = existing.map((camera) => camera.streamReference).filter((value): value is string => Boolean(value));
  const added: Array<{ id: string; cameraName: string; ip: string; monitoring: boolean; error?: string }> = [];
  const failed: Array<{ ip: string; error: string }> = [];

  for (const camera of wanted) {
    const streamUrl = `rtsp://${camera.ip}:554/cam/realmonitor?channel=1&subtype=1`;
    if (known.some((ref) => ref === streamUrl || ref.includes(`://${camera.ip}:`) || ref.includes(`@${camera.ip}:`))) {
      failed.push({ ip: camera.ip, error: 'This camera is already added.' });
      continue;
    }
    try {
      const created = await createCamera(
        ctx,
        {
          cameraName: `CP Plus ${camera.ip}`,
          cameraType: 'LAN_PORT',
          location: input.location,
          site: input.site ?? null,
          streamUrl,
          username: input.username,
          password: input.password,
          samplingFps: input.samplingFps ?? 8,
        },
        ip,
      );
      known.push(created.streamReference ?? streamUrl);
      let monitoring = false;
      let error: string | undefined;
      try {
        await startMonitoring(ctx, created.id, ip);
        monitoring = true;
      } catch (err) {
        error = (err as Error).message;
      }
      added.push({ id: created.id, cameraName: created.cameraName, ip: camera.ip, monitoring, error });
    } catch (err) {
      failed.push({ ip: camera.ip, error: err instanceof AppError ? err.message : (err as Error).message });
    }
  }

  if (!added.length) {
    throw new AppError(400, 'CP_PLUS_NOT_ADDED', failed.map((item) => `${item.ip}: ${item.error}`).join(' ') || 'No camera could be added.');
  }
  return { added, failed, notice: found.notice };
}
