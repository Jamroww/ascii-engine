import './style.css';
import { Engine } from './core/Engine';
import { WaterLayer } from './rendering/WaterLayer';
import { BuildingLayer, createRiversideCottage } from './rendering/BuildingLayer';
import { ForestLayer, generateRiversideForest } from './rendering/ForestLayer';
import { WeatherLayer } from './rendering/WeatherLayer';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const engine = new Engine(app);

const water = new WaterLayer(engine.atlas, 140);
const forest = new ForestLayer(engine.atlas, generateRiversideForest());
const buildings = new BuildingLayer(engine.atlas, [
  { asset: createRiversideCottage(), worldX: -10, worldY: 2 },
]);
const weather = new WeatherLayer(engine.atlas);

engine.addLayer(water);
engine.addLayer(forest);
engine.addLayer(buildings);
engine.addLayer(weather);

engine.start();