// Math & mapping
export * from "./math/vec";
export * from "./mapping/uv";

// Schema (Rig data model)
export * from "./schema";

// Geometry
export * from "./geometry/mesh";
export { icosahedron } from "./geometry/icosahedron";
export { subdivide } from "./geometry/geodesic";
export { octahedron, tetrahedron } from "./geometry/platonic";
export {
  rawSolid,
  meshToSolid,
  generateSolid,
  IMPLEMENTED_SOLID_PRESETS,
  unitEdgeLength,
  edgeLengthForRadius,
  radiusForEdgeLength,
} from "./geometry/solids";
export {
  buildFaceAdjacency,
  activeFaces,
  activeFaceAdjacency,
  faceCentroidDir,
  faceCentroidUv,
} from "./geometry/adjacency";

// LED layout & resolution
export * from "./layout/face-layout";
export * from "./layout/face-metrics";
export * from "./resolve";
export * from "./wiring";

// Presets
export * from "./presets";

// Color management & power
export * from "./color";
export * from "./power";
export * from "./device-profile";

// Export artifacts
export * from "./export/calibration";
export * from "./export/header";
export * from "./export/studio-layout";
