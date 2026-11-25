/* legal.js — solo pinta el encabezado en las páginas legales */
import { mountHeader, toast, errMessage } from './core.js?v=3b15e8e6';

mountHeader({}).catch((err) => toast(errMessage(err), 'err'));
