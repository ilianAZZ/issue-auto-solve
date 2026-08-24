/** Baked into the image by the `image` workflow at build time (format YYYY.MM.DD.N),
 *  so it reflects what actually shipped rather than package.json's hand-edited number. */
export function appVersion(): string {
  return process.env.APP_VERSION ?? 'dev';
}
