

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { activeFaceAdjacency, type Rig } from "@glowbe/core";
import {
  WIRING_CHANNEL_COLORS,
  WIRING_ROW_CHECK_COLORS,
  wiringCheckedRowColorSlot,
} from "@/chain-editor/wiring-helpers";

function centroidWorld(face: Rig["solid"]["faces"][0]): [number, number, number] {
  const v = face.vertices;
  if (v.length < 3) return [0, 0, 0];
  const a = v[0]!;
  const b = v[1]!;
  const c = v[2]!;
  return [(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3];
}

export type HopArrowPlacement = "segment" | "centroidHop";

type ArrowBuild = {
  tail: THREE.Vector3;
  quat: THREE.Quaternion;
  lineGeo: THREE.BufferGeometry;
  shaftLen: number;
  headLen: number;
  headW: number;
  /** mesh local Y of cone center */
  coneY: number;
};

function buildArrowGeometry(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  placement: HopArrowPlacement,
): ArrowBuild | null {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  if (len < 1e-6) return null;
  dir.normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

  let tail: THREE.Vector3;
  let shaftLen: number;
  let headLen: number;
  let headW: number;

  if (placement === "centroidHop") {
    tail = new THREE.Vector3(ax, ay, az);
    headLen = Math.min(Math.max(len * 0.2, 0.04), len * 0.38);
    headW = headLen * 0.55;
    shaftLen = Math.max(len - headLen, len * 0.1);
  } else {
    const tailAlong = len * 0.42;
    tail = new THREE.Vector3(ax, ay, az).addScaledVector(dir, tailAlong);
    const rem = len - tailAlong;
    if (rem < 1e-6) return null;
    headLen = Math.min(Math.max(rem * 0.22, 0.02), rem * 0.45);
    headW = headLen * 0.55;
    shaftLen = Math.max(rem - headLen, rem * 0.08);
  }

  const coneY = shaftLen + headLen / 2;
  const lineGeo = new THREE.BufferGeometry();
  const pos = new Float32Array([0, 0, 0, 0, shaftLen, 0]);
  lineGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  return {
    tail,
    quat,
    lineGeo,
    shaftLen,
    headLen,
    headW,
    coneY,
  };
}

/**
 * Din→Dout direction hint: `segment` = short arrow partway along ab (e.g. LED→LED);
 * `centroidHop` = shaft from face A centroid toward B with cone at B.
 * Uses mesh + line (not ArrowHelper). **Always drawn** regardless of global “hide back-facing” UI.
 */
export function HopDirectionArrow({
  ax,
  ay,
  az,
  bx,
  by,
  bz,
  color,
  hideBackface: _hideBackface,
  dimmed,
  placement = "segment",
}: {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  color: string;
  /** Ignored: hop arrows always draw (no back-face cull on this primitive). */
  hideBackface: boolean;
  dimmed: boolean;
  placement?: HopArrowPlacement;
}) {
  const built = useMemo(
    () => buildArrowGeometry(ax, ay, az, bx, by, bz, placement),
    [ax, ay, az, bx, by, bz, placement],
  );

  const lineMatRef = useRef<THREE.LineBasicMaterial>(null);
  const coneMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useLayoutEffect(() => {
    const lineM = lineMatRef.current;
    const coneM = coneMatRef.current;
    if (!lineM || !coneM) return;
    const o = dimmed ? 0.25 : 1;
    lineM.opacity = o;
    coneM.opacity = o;
  }, [dimmed, built]);

  useEffect(
    () => () => {
      built?.lineGeo.dispose();
    },
    [built],
  );

  if (!built) return null;

  const c = new THREE.Color(color);

  return (
    <group position={built.tail} quaternion={built.quat} renderOrder={8}>
      <lineSegments geometry={built.lineGeo} frustumCulled={false}>
        <lineBasicMaterial
          ref={lineMatRef}
          attach="material"
          color={c}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
      <mesh position={[0, built.coneY, 0]} frustumCulled={false} renderOrder={8}>
        <coneGeometry args={[built.headW, built.headLen, 8]} />
        <meshBasicMaterial
          ref={coneMatRef}
          attach="material"
          color={c}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Per-pin chains in rig space: Din→Dout as **arrows from face centroid to face centroid**. */
export function WiringChainLines({
  rig,
  wirePinChains,
  hideBackface,
  focusedPinRow,
  checkedPinRows,
}: {
  rig: Rig;
  wirePinChains: string[][];
  hideBackface: boolean;
  /** When no `checkedPinRows`, only this row is drawn (if set). */
  focusedPinRow: number | null;
  /** When non-empty, only these rows are drawn, colored by stable check order. */
  checkedPinRows: readonly number[];
}) {
  const adj = useMemo(() => activeFaceAdjacency(rig), [rig]);
  const faceMap = useMemo(() => new Map(rig.solid.faces.map((f) => [f.id, f])), [rig]);

  const segments = useMemo(() => {
    const out: {
      key: string;
      rowIndex: number;
      ax: number;
      ay: number;
      az: number;
      bx: number;
      by: number;
      bz: number;
      color: string;
    }[] = [];
    const useChecked = checkedPinRows.length > 0;
    const checkedSet = new Set(checkedPinRows);
    wirePinChains.forEach((rawRow, rowIndex) => {
      if (useChecked) {
        if (!checkedSet.has(rowIndex)) return;
      } else if (focusedPinRow != null && rowIndex !== focusedPinRow) {
        return;
      }
      const row = rawRow.filter((id) => id.length > 0);
      const slot = wiringCheckedRowColorSlot(checkedPinRows, rowIndex);
      const chCol = useChecked
        ? WIRING_ROW_CHECK_COLORS[(slot ?? 0) % WIRING_ROW_CHECK_COLORS.length]!
        : WIRING_CHANNEL_COLORS[rowIndex % WIRING_CHANNEL_COLORS.length]!;
      for (let i = 0; i < row.length - 1; i++) {
        const fa = row[i]!;
        const fb = row[i + 1]!;
        const a = faceMap.get(fa);
        const b = faceMap.get(fb);
        if (!a || !b) continue;
        const [ax, ay, az] = centroidWorld(a);
        const [bx, by, bz] = centroidWorld(b);
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        if (dx * dx + dy * dy + dz * dz < 1e-10) continue;
        const adjacent = adj.get(fa)?.has(fb) ?? false;
        const color = adjacent ? chCol : "#fb923c";
        out.push({
          key: `r${rowIndex}-${fa}-${fb}`,
          rowIndex,
          ax,
          ay,
          az,
          bx,
          by,
          bz,
          color,
        });
      }
    });
    return out;
  }, [adj, checkedPinRows, faceMap, focusedPinRow, wirePinChains]);

  return (
    <group>
      {segments.map((s) => (
        <HopDirectionArrow
          key={s.key}
          ax={s.ax}
          ay={s.ay}
          az={s.az}
          bx={s.bx}
          by={s.by}
          bz={s.bz}
          color={s.color}
          hideBackface={hideBackface}
          dimmed={false}
          placement="centroidHop"
        />
      ))}
    </group>
  );
}
