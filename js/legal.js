/* legal.js — solo pinta el encabezado en las páginas legales */
import { mountHeader, toast, errMessage } from './core.js?v=828d81de';

mountHeader({}).catch((err) => toast(errMessage(err), 'err'));
