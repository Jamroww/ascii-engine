import './style.css';
import { Engine } from './core/Engine';
import { WaterLayer } from './rendering/WaterLayer';
import { WeatherLayer } from './rendering/WeatherLayer';
import { PropLayer, type PropPlacement } from './rendering/PropLayer';
import {
  createPine,
  createOak,
  createWiltedTree,
  createWiltedFlower,
  createRock,
  createBush,
  createStump,
  createMushrooms,
} from './rendering/propAssets';
import { riverSDF } from './core/world';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const engine = new Engine(app);

// --- Assets ---------------------------------------------------------------
const pine = createPine();
const oak = createOak();
const wiltedTree = createWiltedTree();
const flower = createWiltedFlower();
const rock = createRock();
const bush = createBush();
const stump = createStump();
const mushrooms = createMushrooms();

// --- Compose the starting area -------------------------------------------
const placements: PropPlacement[] = [];

// Landmark: the namesake wilted flower, drooping beside the spawn clearing.
placements.push({
  asset: flower,
  worldX: -3.0,
  worldY: -2.8,
  cellSize: 0.5,
  colliderRadius: 0.45,
  colliderX: -2.8,
  colliderY: -2.3,
});

// A handful of hero trees framing the spawn.
placements.push({ asset: oak, worldX: -6.2, worldY: 2.2, cellSize: 0.46, colliderRadius: 0.55 });
placements.push({ asset: wiltedTree, worldX: 3.4, worldY: -5.6, cellSize: 0.46, colliderRadius: 0.5 });
placements.push({ asset: pine, worldX: -7.8, worldY: -4.2, cellSize: 0.46, colliderRadius: 0.5 });
placements.push({ asset: pine, worldX: -0.8, worldY: 4.8, cellSize: 0.44, colliderRadius: 0.48 });
placements.push({ asset: oak, worldX: 2.4, worldY: 2.8, cellSize: 0.44, colliderRadius: 0.55 });

// Rocks, stumps, bushes and mushrooms scattered across the grass.
placements.push({ asset: rock, worldX: -4.2, worldY: 1.2, cellSize: 0.52, colliderRadius: 0.72 });
placements.push({ asset: stump, worldX: 5.0, worldY: 1.6, cellSize: 0.5, colliderRadius: 0.5 });
placements.push({ asset: bush, worldX: -8.6, worldY: 0.6, cellSize: 0.5, colliderRadius: 0.42 });
placements.push({ asset: bush, worldX: -0.6, worldY: -6.4, cellSize: 0.5, colliderRadius: 0.42 });
placements.push({ asset: mushrooms, worldX: -1.6, worldY: 3.6, cellSize: 0.46, colliderRadius: 0.22 });

// A dense treeline ring that encloses the whole clearing.
const ringCount = 120;
for (let i = 0; i < ringCount; i++) {
  const angle = (i / ringCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.03;
  const radius = 17.5 + (Math.random() - 0.5) * 3.0;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  // Leave the river mouth clear so the water can flow out of the clearing.
  if (riverSDF(x, y) < 0.6) continue;

  const roll = Math.random();
  const tree = roll < 0.55 ? pine : roll < 0.85 ? oak : wiltedTree;
  const cellSize = 0.4 + Math.random() * 0.1;
  placements.push({
    asset: tree,
    worldX: x + cellSize / 2,
    worldY: y - cellSize,
    cellSize,
    colliderRadius: 0.5,
  });
}

// --- Layers ---------------------------------------------------------------
const propLayer = new PropLayer(engine.atlas, placements);
engine.addLayer(propLayer);
engine.collision.addMany(propLayer.getColliders());

engine.addLayer(new WaterLayer(engine.atlas));
engine.addLayer(new WeatherLayer(engine.atlas));

engine.start();
