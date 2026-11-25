/* legal.js — solo pinta el encabezado en las páginas legales */
import { mountHeader, toast, errMessage } from './core.js?v=ff7704d8';

mountHeader({}).catch((err) => toast(errMessage(err), 'err'));
