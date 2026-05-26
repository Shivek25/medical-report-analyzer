import { Router } from 'express';
import { renderHomePage } from '../../views/HomePage/index.js';

export const viewRoute = Router();

viewRoute.get('/', (_req, res) => {
  res.send(renderHomePage());
});
