# Model credits

## Car — `pagani.glb`

Used by the Drive mode.

- Source: [Vecarz](https://www.vecarz.com/) — Pagani Huayra Codalunga, fetched
  from their free models section (`pagani_huayra_codalunga__www.vecarz.com`).
- Converted to glTF as shipped; wheel hubs, orientation and scale are measured
  at load time in `src/game/car.ts` (`PAGANI_RIG`).
- Licence: Vecarz free-model terms — personal/non-commercial use. Replace with
  a self-made or licensed model before any commercial release.

## Character — `robot.glb`

Used by the Walk mode.

- Source: [three.js](https://github.com/mrdoob/three.js) examples,
  `examples/models/gltf/RobotExpressive/RobotExpressive.glb`, fetched from the
  `dev` branch. Unmodified.
- Author: Tomás Laulhé ([Quaternius](https://quaternius.com)), with
  modifications by Don McCurdy.
- Licence: **CC0 1.0** (public domain dedication), as stated in three.js's
  model licence listing for this file.

The clips used are `Idle`, `Walking` and `Running`; the file also carries
`Jump`, `Wave`, `Dance` and others that nothing plays yet.

Scale, footing and orientation are normalised at load time in
`src/game/walker.ts` — the file is shipped exactly as fetched.
