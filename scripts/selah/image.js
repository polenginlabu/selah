// Turns whatever the image model returned into the one format SELAH ships:
// 1080x1920 WebP, small enough to load instantly on mobile data.
//
// A separate step because the model's output resolution is not a promise. Nano
// Banana returns roughly the aspect ratio it was asked for, not exactly the
// pixels, and a card that is 1084 wide one day and 1024 the next would shift
// the typography under it. Normalising here means the renderer can treat the
// background as a fixed canvas.

import sharp from 'sharp'
import { IMAGE_WIDTH, IMAGE_HEIGHT, BackgroundError } from './background.js'

// 82 sits at the knee of the quality/size curve for soft photographic content
// like this — visually indistinguishable from 95 on a phone, roughly half the
// bytes. These are gradients and mist, not fine detail.
const WEBP_QUALITY = 82

/**
 * @param {Buffer} input  bytes from the model, any format or size
 * @returns {Promise<{buffer: Buffer, width: number, height: number, bytes: number}>}
 */
export async function toBackgroundWebp(input) {
  let output
  try {
    output = await sharp(input)
      // `cover` crops rather than distorts. The prompt asks for calm negative
      // space through the middle, so trimming the edges of an off-ratio frame
      // costs nothing; squashing it to fit would be visible immediately.
      .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: 'cover', position: 'centre' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer()
  } catch (err) {
    throw new BackgroundError(`Could not process the generated image: ${err.message}`, 'process')
  }

  const meta = await sharp(output).metadata()
  if (meta.width !== IMAGE_WIDTH || meta.height !== IMAGE_HEIGHT) {
    throw new BackgroundError(
      `Processing produced ${meta.width}x${meta.height}, expected ${IMAGE_WIDTH}x${IMAGE_HEIGHT}.`,
      'process'
    )
  }

  return { buffer: output, width: meta.width, height: meta.height, bytes: output.length }
}
