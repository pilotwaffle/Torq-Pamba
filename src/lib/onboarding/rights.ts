/** Unconfirmed assets stay in the library and are refused for video generation. */
export function canUseAssetInVideo(asset: { rightsConfirmed: boolean }): boolean {
  return asset.rightsConfirmed;
}
