import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

/**
 * Optimize an image buffer (resize + webp) and upload to a Supabase Storage
 * bucket. Returns { path, url }.
 */
export async function uploadImage(buffer, { bucket = env.buckets.products, folder = '' } = {}) {
  const optimized = await sharp(buffer)
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const path = `${folder ? folder + '/' : ''}${uuidv4()}.webp`;

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, optimized, { contentType: 'image/webp', upsert: false });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

/** Upload an arbitrary file buffer (e.g. PDF) to storage. */
export async function uploadFile(buffer, { bucket, path, contentType }) {
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

export async function removeFile(bucket, path) {
  if (!path) return;
  await supabaseAdmin.storage.from(bucket).remove([path]);
}
