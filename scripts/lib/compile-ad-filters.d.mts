import type {NetworkFilter} from '@ghostery/adblocker';
import type {Cosmetics} from '../../extension/lib/adblock-policy';
export function compileNetworkFilter(filter:NetworkFilter):Omit<chrome.declarativeNetRequest.Rule,'id'>|null;
export function compileAdFilters(text:string):{rules:chrome.declarativeNetRequest.Rule[];cosmetics:Cosmetics;stats:Record<string,number>};
