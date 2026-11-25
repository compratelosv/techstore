/* legal.js — solo pinta el encabezado en las páginas legales */
import { mountHeader, toast, errMessage } from './core.js?v=64144037';

mountHeader({}).catch((err) => toast(errMessage(err), 'err'));
