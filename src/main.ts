import './style.css';
import { Engine } from './core/Engine';
import { WaterLayer } from './rendering/WaterLayer';
import { WeatherLayer } from './rendering/WeatherLayer';
import { PropLayer, createSamplePineTree } from './rendering/PropLayer';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const engine = new Engine(app);
const pine = createSamplePineTree();

engine.addLayer(new WaterLayer(engine.atlas));
engine.addLayer(
  new PropLayer(engine.atlas, [
    { asset: pine, worldX: -5, worldY: 3 },
    { asset: pine, worldX: -8, worldY: -2 },
    { asset: pine, worldX: -3, worldY: -6 },
    { asset: pine, worldX: 1, worldY: 6 },
    { asset: pine, worldX: -11, worldY: 5 },
  ])
);
engine.addLayer(new WeatherLayer(engine.atlas));
engine.start();