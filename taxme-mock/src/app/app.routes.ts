import { Routes } from '@angular/router';
import {Taxme} from './components/taxme/taxme';
import {Postfinance} from './components/postfinance/postfinance';
import {Bekb} from './components/bekb/bekb';

export const routes: Routes = [
  {
    path: 'taxme',
    component: Taxme,
  },
  {
    path: 'bekb',
    component: Bekb,
  },
  {
    path: 'postfinance',
    component: Postfinance,
  },
  {
    path: '',
    component: Taxme,
  },
];
