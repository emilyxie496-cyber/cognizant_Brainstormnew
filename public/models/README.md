# Real 3D models for the Command Center

The hero scene builds its ship, airplane, train and truck in code. To use a real
model instead, put a `.glb` file in this folder and list it in `manifest.json`.

```json
{
  "ship": { "file": "ship.glb", "rotateY": 0, "scale": 1, "lift": 0 },
  "plane": { "file": "plane.glb", "rotateY": 90 }
}
```

- Keys: `ship`, `plane`, `train`, `truck`. Leave one out to keep the built-in model.
- `file`: the file name in this folder. Use binary glTF (`.glb`) without Draco compression.
- `rotateY`: degrees to turn the model so its front points along +x (the direction of travel).
- `scale`: optional size multiplier. Models are already scaled to fit the scene.
- `lift`: optional height adjustment. Use a negative value to sit a ship lower in the water.

If a file fails to load, the built-in model stays and a warning is logged in the
browser console. Check each model's licence before you ship it.
