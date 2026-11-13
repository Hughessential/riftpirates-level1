# Player ship collection

`spaceships.vox` is the unmodified `Voxel Spaceships/Spaceships.vox` supplied by
the project owner in `Voxel Spaceships.zip`. Its six independent models are
loaded in source chunk order by `src/render/PlayerFleet.js`.

Runtime changes center and normalize each hull, turn its nose toward -Z, and
replace the original eight paint channels with the Rift Pirates palette.
Original voxel silhouettes, panel layouts and fin details are retained. Only
engine and lamp paint emits light. All six hulls are cosmetic and share the
same player stats, weapons, movement and collision volume.

The source archive also contains Blender/OBJ files, normal maps and a cover
preview; these are not needed by the runtime and are not copied into the game.
No creator attribution or license file was included in this supplied archive.
