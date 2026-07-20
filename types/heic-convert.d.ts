declare module "heic-convert" {
  type HeicConvertOptions = {
    buffer: ArrayBufferLike | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  function convert(options: HeicConvertOptions): Promise<Uint8Array>;

  export default convert;
}
