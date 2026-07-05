/**
 * A FrameSource is what the playback engine loads. Phase 1+ supports a single
 * 2:1 equirectangular image, an image sequence (multiple files sorted by name),
 * and a video. Future sources (shaders, live input) plug in here.
 */
export type FrameSource =
  | { kind: "none" }
  | { kind: "image"; url: string; width: number; height: number; name: string }
  | {
      kind: "image-sequence";
      urls: string[];
      width: number;
      height: number;
      name: string;
      fps: number;
    }
  | { kind: "video"; url: string; width: number; height: number; name: string };

const probeImage = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });

const probeVideo = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      resolve({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => reject(new Error("Failed to load video"));
    video.src = url;
  });

/** Natural sort so frame_2 comes before frame_10. */
const byNameNatural = (a: File, b: File) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

const DEFAULT_SEQUENCE_FPS = 60;

/**
 * Build a FrameSource from one or more files. A single video wins; multiple
 * images become a sequence sorted by name; a single image is a still.
 */
export const createFrameSourceFromFiles = async (
  fileList: FileList | File[],
): Promise<FrameSource> => {
  const files = Array.from(fileList);
  const video = files.find((f) => f.type.startsWith("video/"));
  if (video) {
    const url = URL.createObjectURL(video);
    const { width, height } = await probeVideo(url);
    return { kind: "video", url, width, height, name: video.name };
  }

  const images = files.filter((f) => f.type.startsWith("image/")).sort(byNameNatural);
  if (images.length === 0) {
    throw new Error("No image or video files were provided.");
  }

  const urls = images.map((f) => URL.createObjectURL(f));
  const { width, height } = await probeImage(urls[0]!);

  if (images.length === 1) {
    return { kind: "image", url: urls[0]!, width, height, name: images[0]!.name };
  }
  return {
    kind: "image-sequence",
    urls,
    width,
    height,
    name: `${images[0]!.name} … (+${images.length - 1})`,
    fps: DEFAULT_SEQUENCE_FPS,
  };
};
