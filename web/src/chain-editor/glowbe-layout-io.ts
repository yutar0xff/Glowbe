import {
  buildWiringFromChains,
  generateSolid,
  wirePinChainsFromRig,
  type FaceLayout,
  type Rig,
} from '@glowbe/core'
import { applyWiringToRig } from '@/chain-editor/stores/editor-wiring-rig'
import type { EditorState } from '@/chain-editor/stores/editor-store-types'

export type GlowbeLayout = {
  format: 'glowbe-layout'
  version: 1
  id: string
  displayName: string
  variant: string
  geometry: {
    preset: string
    radiusMm: number
    units: 'mm'
    disabledFaceIds: string[]
  }
  face: {
    ledCount: number
    pattern: FaceLayout['pattern']
    paddingMm: number
    chainMirrorLR: boolean
    rowSizes?: number[]
  }
  wiring: {
    chip: string
    colorOrder: string
    dataLines: Array<{
      gpio: number
      faceChain: string[]
      faceRotations: Record<string, number>
      reversedFaces: string[]
    }>
  }
}

export function glowbeLayoutToRig(layout: GlowbeLayout): Rig {
  const solid = generateSolid(
    layout.geometry.preset as Parameters<typeof generateSolid>[0],
    layout.geometry.radiusMm,
  )
  solid.disabledFaceIds = [...layout.geometry.disabledFaceIds]

  const faceLayout: FaceLayout = {
    faceType: 'triangle',
    ledCount: layout.face.ledCount,
    pattern: layout.face.pattern,
    paddingMm: layout.face.paddingMm,
    padding: 0,
    chainEntry: 0,
    chainMirrorLR: layout.face.chainMirrorLR,
    ...(layout.face.rowSizes ? { rowSizes: layout.face.rowSizes } : {}),
  }

  const chains = layout.wiring.dataLines.map((d) => d.faceChain)
  const pins = layout.wiring.dataLines.map((d) => d.gpio)
  const reversed = layout.wiring.dataLines.flatMap((d) => d.reversedFaces)
  const faceRotations = Object.assign(
    {},
    ...layout.wiring.dataLines.map((d) => d.faceRotations),
  )

  const { parts, channels } = buildWiringFromChains({
    chains,
    pins,
    reversed,
    faceRotations,
  })

  return {
    meta: {
      id: layout.id,
      name: layout.displayName,
      schemaVersion: 1,
      units: 'mm',
    },
    solid,
    faceLayouts: [faceLayout],
    parts,
    channels,
  }
}

export function editorStateToGlowbeLayout(
  state: Pick<
    EditorState,
    | 'rig'
    | 'wirePinChains'
    | 'wirePinGpio'
    | 'wireReversed'
    | 'wireFaceRotations'
    | 'wireConfigured'
  >,
  meta: { variant: string; chip?: string; colorOrder?: string },
): GlowbeLayout {
  const rig = applyWiringToRig(
    state.rig,
    state.wirePinChains,
    state.wirePinGpio,
    state.wireReversed,
    state.wireFaceRotations,
    state.wireConfigured,
  )

  const faceLayout = rig.faceLayouts[0]
  if (!faceLayout) {
    throw new Error('Rig must have a face layout')
  }

  const { chains, gpio } = wirePinChainsFromRig(rig)
  const partById = new Map(rig.parts.map((p) => [p.id, p]))
  const channelByIndex = new Map(rig.channels.map((c) => [c.index, c]))

  const dataLines = chains.map((faceChain, chIndex) => {
    const ch = channelByIndex.get(chIndex)
    const faceRotations: Record<string, number> = {}
    const reversedFaces: string[] = []
    if (ch) {
      for (const partId of ch.partIds) {
        const part = partById.get(partId)
        if (!part) continue
        for (const conn of part.faceConnections ?? []) {
          if (conn.rotation != null && conn.rotation !== 0) {
            faceRotations[conn.faceId] = conn.rotation
          }
          if (conn.reversed) {
            reversedFaces.push(conn.faceId)
          }
        }
      }
    }
    return {
      gpio: gpio[chIndex] ?? -1,
      faceChain,
      faceRotations,
      reversedFaces,
    }
  })

  return {
    format: 'glowbe-layout',
    version: 1,
    id: rig.meta.id,
    displayName: rig.meta.name,
    variant: meta.variant,
    geometry: {
      preset: rig.solid.preset,
      radiusMm: rig.solid.radius,
      units: 'mm',
      disabledFaceIds: [...rig.solid.disabledFaceIds],
    },
    face: {
      ledCount: faceLayout.ledCount,
      pattern: faceLayout.pattern,
      paddingMm: faceLayout.paddingMm ?? 0,
      chainMirrorLR: faceLayout.chainMirrorLR ?? false,
      ...(faceLayout.rowSizes ? { rowSizes: faceLayout.rowSizes } : {}),
    },
    wiring: {
      chip: meta.chip ?? 'SK6805',
      colorOrder: meta.colorOrder ?? 'GRB',
      dataLines,
    },
  }
}

export function glowbeLayoutToEditorPatch(layout: GlowbeLayout): Partial<EditorState> {
  const rig = glowbeLayoutToRig(layout)
  const chains = layout.wiring.dataLines.map((d) => [...d.faceChain])
  const gpio = layout.wiring.dataLines.map((d) => d.gpio)
  const reversed = layout.wiring.dataLines.flatMap((d) => d.reversedFaces)
  const faceRotations = Object.assign(
    {},
    ...layout.wiring.dataLines.map((d) => d.faceRotations),
  )
  const configured = chains.some((row) => row.some((id) => id.length > 0))

  const rigWithWiring = applyWiringToRig(
    rig,
    chains,
    gpio,
    reversed,
    faceRotations,
    configured,
  )

  return {
    rig: {
      ...rigWithWiring,
      meta: {
        ...rigWithWiring.meta,
        id: layout.id,
        name: layout.displayName,
      },
    },
    wirePinChains: chains,
    wirePinGpio: gpio,
    wireReversed: reversed,
    wireFaceRotations: faceRotations,
    wireConfigured: configured,
    wiringCheckedPinIndices: chains.map((_, i) => i),
    selectedFaceIds: [],
    wiringAssignmentTarget: null,
    wiringWalkPinIndex: null,
    wiringFocusedPinIndex: null,
    attachmentPreviewCell: null,
    error: null,
  }
}
