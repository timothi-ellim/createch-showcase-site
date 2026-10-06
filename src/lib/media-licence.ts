// Reviewed source attribution for this exact prepared image, checked 6 October 2026.
// Supplement the participant's immutable credit without changing their submission.
const socialNetworkImage =
  '/media/e6ac1c2da21c6675c58a92f1144a6ca236067a9c827528668432a4de11402a5f.webp';

export function mediaLicenceMarkup(src: string): string {
  if (src !== socialNetworkImage) return '';
  return ' <span class="media-licence">· <a href="https://www.flickr.com/photos/60506610@N08/16181710782" rel="noopener noreferrer">Social Network II — Manel Torralba</a> · <a href="https://creativecommons.org/licenses/by/2.0/" rel="license noopener noreferrer">CC BY 2.0</a>. Resized and converted to WebP.</span>';
}
