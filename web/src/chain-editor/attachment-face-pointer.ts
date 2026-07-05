import type { ThreeEvent } from "@react-three/fiber";
import { useEditorStore } from "@/chain-editor/stores/editor-store";

/** 3D でクリックした面が表にあれば、そのセルを Face Attachment のプレビューにする。 */
export function attachmentFacePointerDown(faceId: string, _e: ThreeEvent<PointerEvent>) {
  const chains = useEditorStore.getState().wirePinChains;
  for (let ri = 0; ri < chains.length; ri++) {
    const row = chains[ri] ?? [];
    for (let ci = 0; ci < row.length; ci++) {
      if (row[ci] === faceId) {
        useEditorStore.getState().setAttachmentPreviewCell({ ri, ci });
        return;
      }
    }
  }
  useEditorStore.getState().setAttachmentPreviewCell(null);
}
