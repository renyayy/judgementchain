import { convertFileSrc } from "@tauri-apps/api/core";

interface FileViewerProps {
  filePath: string;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

function getExt(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export function FileViewer({ filePath }: FileViewerProps) {
  const ext = getExt(filePath);
  const src = convertFileSrc(filePath);
  const fileName = filePath.split("/").pop() ?? filePath;

  if (IMAGE_EXTS.includes(ext)) {
    return (
      <div className="file-viewer file-viewer--image">
        <img src={src} alt={fileName} />
      </div>
    );
  }

  if (ext === "pdf") {
    return (
      <div className="file-viewer file-viewer--pdf">
        <iframe
          src={src}
          title={fileName}
          width="100%"
          height="100%"
        />
      </div>
    );
  }

  return (
    <div className="file-viewer file-viewer--unsupported">
      <p>このファイル形式は表示できません: {fileName}</p>
    </div>
  );
}

export function isViewableFile(path: string) {
  const ext = getExt(path);
  return IMAGE_EXTS.includes(ext) || ext === "pdf";
}

export function isMarkdown(path: string) {
  return getExt(path) === "md";
}
