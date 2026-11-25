/* legal.js — solo pinta el encabezado en las páginas legales */
import { mountHeader, toast, errMessage } from './core.js?v=454f869e';

mountHeader({}).catch((err) => toast(errMessage(err), 'err'));
