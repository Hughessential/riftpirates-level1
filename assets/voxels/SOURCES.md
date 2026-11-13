# Imported voxel assets

These seven original `.vox` models were supplied by the project owner in
`assets examples and sources.zip`. Only the runtime models are included here;
the large source archive, Blender/FBX files, GIF previews and macOS metadata are
not part of the web bundle.

| Runtime file | Original archive entry |
| --- | --- |
| red-fighter.vox | Package-8/RedFighter.vox |
| dual-striker.vox | Package-7/DualStriker.vox |
| intruder.vox | Package-6/UltravioletIntruder.vox |
| camo-jet.vox | Package-2/CamoStellarJet.vox |
| micro-recon.vox | Package-9/MicroRecon.vox |
| mecha-golem.vox | Package-10/MechaGolem.vox |
| companion.vox | Package-15/Companion-bot.vox |

The models retain their authored palettes and voxel detail. Three.js converts
them to greedy exposed-face meshes, with bright palette cells used for local
engine/eye emission. Centering and scale happen at runtime without altering
the original source files. Asset identity and source filenames are exposed in
`src/render/ImportedAssets.js`.

No license or creator attribution file was present among the archive entries.
This records provenance; it does not establish redistribution rights for the
supplied third-party artwork.
