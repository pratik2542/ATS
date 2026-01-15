export type CloudinaryUploadResult = {
  secureUrl: string;
  publicId: string;
  resourceType?: string;
  format?: string;
  bytes?: number;
  originalFilename?: string;
};

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || '';
const defaultFolder = process.env.CLOUDINARY_FOLDER || 'ats-resume-tracker';

export const isCloudinaryEnabled = (): boolean => {
  return Boolean(cloudName && uploadPreset);
};

export const getCloudinaryConfigError = (): string | null => {
  if (!cloudName) return 'Missing CLOUDINARY_CLOUD_NAME in .env';
  if (!uploadPreset)
    return (
      'Missing CLOUDINARY_UPLOAD_PRESET in .env. Create an UNSIGNED upload preset in Cloudinary and paste its name here.'
    );
  return null;
};

export const uploadFileToCloudinary = async (
  file: Blob,
  opts?: {
    filename?: string;
    folder?: string;
    tags?: string[];
  }
): Promise<CloudinaryUploadResult> => {
  const configError = getCloudinaryConfigError();
  if (configError) throw new Error(configError);

  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`;

  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', uploadPreset);
  form.append('folder', opts?.folder || defaultFolder);
  // NOTE: unsigned uploads do NOT allow passing `access_mode`.
  // If you need public accessibility, configure it in the unsigned upload preset
  // inside Cloudinary (Console → Settings → Upload → Upload presets).
  if (opts?.filename) form.append('public_id', opts.filename);
  if (opts?.tags?.length) form.append('tags', opts.tags.join(','));

  const res = await fetch(url, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const hint =
      text.includes('Access mode parameter is not allowed when using unsigned upload')
        ? ' Remove access_mode and configure public access in the unsigned upload preset.'
        : '';
    throw new Error(`Cloudinary upload failed (${res.status}). ${text || ''}${hint}`.trim());
  }

  const json: any = await res.json();
  const secureUrl = String(json.secure_url || '');
  const publicId = String(json.public_id || '');

  if (!secureUrl || !publicId) {
    throw new Error('Cloudinary upload failed: missing secure_url/public_id');
  }

  // Sanity check: ensure the returned URL is actually accessible.
  // If the Cloudinary account/preset enforces access control, the URL may 401 with
  // `x-cld-error: deny or ACL failure` and Chrome will show “Failed to load PDF document”.
  try {
    const head = await fetch(secureUrl, { method: 'HEAD' });
    if (!head.ok) {
      const cldError = head.headers.get('x-cld-error');
      const status = head.status;
      const hint = cldError ? ` ${cldError}` : '';
      const guidance =
        status === 401 || status === 403
          ? ' Configure your Cloudinary unsigned upload preset to be publicly accessible (no authenticated/ACL delivery).'
          : '';
      throw new Error(`Cloudinary URL is not publicly accessible (${status}).${hint}${guidance}`.trim());
    }
  } catch (e: any) {
    // If HEAD is blocked in some environments, don't hard-fail unless it's an explicit Cloudinary ACL error.
    const msg = String(e?.message || '');
    if (msg.toLowerCase().includes('cloudinary url is not publicly accessible')) {
      throw e;
    }
  }

  return {
    secureUrl,
    publicId,
    resourceType: json.resource_type ? String(json.resource_type) : undefined,
    format: json.format ? String(json.format) : undefined,
    bytes: typeof json.bytes === 'number' ? json.bytes : undefined,
    originalFilename: json.original_filename ? String(json.original_filename) : undefined,
  };
};
