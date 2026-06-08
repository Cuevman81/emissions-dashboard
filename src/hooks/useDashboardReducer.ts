import { useReducer, useRef, useCallback } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Facility, AqsMonitor, NeiFacilityData, NeiCountyData } from '@/lib/data-service';

// ─── ActiveTab type ────────────────────────────────────────────────
export type ActiveTab = 'inventory' | 'psd' | 'toxics' | 'naaqs';

// ─── Map Filter type ───────────────────────────────────────────────
export type MapFilter = 'all' | 'nei' | 'nei2023' | 'camd' | 'tri' | 'major' | 'synthetic' | 'minor';

// ─── Consolidated state shape ──────────────────────────────────────
export interface DashboardState {
  // Data loading
  allFacilities: Facility[];
  loading: boolean;
  isMounted: boolean;
  dataSource: string;

  // Map state
  selectedState: string;
  center: [number, number] | null;
  radiusMi: number;
  selectedFacility: Facility | null;
  selectedMonitor: AqsMonitor | null;
  showAll: boolean;
  mapFilter: MapFilter;
  mapTriYear: string;
  selectedSector: string | null;
  activeTab: ActiveTab;
  tabBeforeAutoSwitch: ActiveTab | null; // tracks if we auto-switched away from a tab

  // NEI state
  neiYear: '2020' | '2023';
  neiData: NeiFacilityData | null;
  neiLoading: boolean;
  countyData: NeiCountyData | null;
  countyLoading: boolean;
  neiSyncStatus: 'checking' | 'up-to-date' | 'updating' | 'error';

  // Class I overlay
  classIGeoJson: FeatureCollection | null;
  showClassI: boolean;
  classILoading: boolean;

  // AQS Monitoring
  aqsMonitors: AqsMonitor[];
  showAqsMonitors: boolean;
  aqsLoading: boolean;
  aqsError: string | null;
  hasRefreshedSession: boolean;
}

// ─── Initial state ─────────────────────────────────────────────────
export const initialState: DashboardState = {
  allFacilities: [],
  loading: true,
  isMounted: false,
  dataSource: '',

  selectedState: 'MS',
  center: null,
  radiusMi: 50,
  selectedFacility: null,
  selectedMonitor: null,
  showAll: false,
  mapFilter: 'all',
  mapTriYear: 'All',
  selectedSector: null,
  activeTab: 'inventory',
  tabBeforeAutoSwitch: null,

  neiYear: '2023',
  neiData: null,
  neiLoading: false,
  countyData: null,
  countyLoading: false,
  neiSyncStatus: 'checking',

  classIGeoJson: null,
  showClassI: false,
  classILoading: false,

  aqsMonitors: [],
  showAqsMonitors: false,
  aqsLoading: false,
  aqsError: null,
  hasRefreshedSession: false,
};

// ─── Action types ──────────────────────────────────────────────────
export type DashboardAction =
  // Data loading
  | { type: 'SET_FACILITIES'; payload: Facility[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_MOUNTED' }
  | { type: 'SET_DATA_SOURCE'; payload: string }

  // Map state
  | { type: 'SET_STATE'; payload: string }
  | { type: 'SET_CENTER'; payload: [number, number] | null }
  | { type: 'SET_RADIUS'; payload: number }
  | { type: 'SELECT_FACILITY'; payload: Facility | null }
  | { type: 'SELECT_MONITOR'; payload: AqsMonitor | null }
  | { type: 'TOGGLE_SHOW_ALL' }
  | { type: 'SET_MAP_FILTER'; payload: MapFilter }
  | { type: 'SET_MAP_TRI_YEAR'; payload: string }
  | { type: 'SET_SECTOR'; payload: string | null }
  | { type: 'SET_ACTIVE_TAB'; payload: ActiveTab }

  // NEI state
  | { type: 'SET_NEI_YEAR'; payload: '2020' | '2023' }
  | { type: 'SET_NEI_DATA'; payload: NeiFacilityData | null }
  | { type: 'SET_NEI_LOADING'; payload: boolean }
  | { type: 'SET_COUNTY_DATA'; payload: NeiCountyData | null }
  | { type: 'SET_COUNTY_LOADING'; payload: boolean }
  | { type: 'SET_NEI_SYNC_STATUS'; payload: 'checking' | 'up-to-date' | 'updating' | 'error' }

  // Class I overlay
  | { type: 'SET_CLASS_I_GEOJSON'; payload: FeatureCollection | null }
  | { type: 'SET_SHOW_CLASS_I'; payload: boolean }
  | { type: 'SET_CLASS_I_LOADING'; payload: boolean }

  // AQS Monitoring
  | { type: 'SET_AQS_MONITORS'; payload: AqsMonitor[] }
  | { type: 'SET_SHOW_AQS_MONITORS'; payload: boolean }
  | { type: 'SET_AQS_LOADING'; payload: boolean }
  | { type: 'SET_AQS_ERROR'; payload: string | null }
  | { type: 'SET_HAS_REFRESHED_SESSION' }

  // Compound actions (batch state resets)
  | { type: 'RESET_FOR_STATE_CHANGE' }
  | { type: 'FACILITY_CLICKED'; payload: Facility }
  | { type: 'FACILITY_CLOSED' }
  | { type: 'MONITOR_CLOSED' }
  | { type: 'CLEAR_MAP_PIN' }
  | { type: 'DESELECT_FACILITY' }
  | { type: 'DESELECT_MONITOR' }
  | { type: 'MONITOR_SELECTED'; payload: AqsMonitor };

// ─── Reducer ───────────────────────────────────────────────────────
function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    // Data loading
    case 'SET_FACILITIES':
      return { ...state, allFacilities: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_MOUNTED':
      return { ...state, isMounted: true };
    case 'SET_DATA_SOURCE':
      return { ...state, dataSource: action.payload };

    // Map state
    case 'SET_STATE':
      return { ...state, selectedState: action.payload };
    case 'SET_CENTER':
      return { ...state, center: action.payload };
    case 'SET_RADIUS':
      return { ...state, radiusMi: action.payload };
    case 'SELECT_FACILITY':
      return { ...state, selectedFacility: action.payload };
    case 'SELECT_MONITOR':
      return { ...state, selectedMonitor: action.payload };
    case 'TOGGLE_SHOW_ALL':
      return { ...state, showAll: !state.showAll };
    case 'SET_MAP_FILTER':
      return { ...state, mapFilter: action.payload };
    case 'SET_MAP_TRI_YEAR':
      return { ...state, mapTriYear: action.payload };
    case 'SET_SECTOR':
      return { ...state, selectedSector: action.payload };
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload, tabBeforeAutoSwitch: null };

    // NEI state
    case 'SET_NEI_YEAR':
      return { ...state, neiYear: action.payload };
    case 'SET_NEI_DATA':
      return { ...state, neiData: action.payload };
    case 'SET_NEI_LOADING':
      return { ...state, neiLoading: action.payload };
    case 'SET_COUNTY_DATA':
      return { ...state, countyData: action.payload };
    case 'SET_COUNTY_LOADING':
      return { ...state, countyLoading: action.payload };
    case 'SET_NEI_SYNC_STATUS':
      return { ...state, neiSyncStatus: action.payload };

    // Class I overlay
    case 'SET_CLASS_I_GEOJSON':
      return { ...state, classIGeoJson: action.payload };
    case 'SET_SHOW_CLASS_I':
      return { ...state, showClassI: action.payload };
    case 'SET_CLASS_I_LOADING':
      return { ...state, classILoading: action.payload };

    // AQS Monitoring
    case 'SET_AQS_MONITORS':
      return { ...state, aqsMonitors: action.payload };
    case 'SET_SHOW_AQS_MONITORS':
      return { ...state, showAqsMonitors: action.payload };
    case 'SET_AQS_LOADING':
      return { ...state, aqsLoading: action.payload };
    case 'SET_AQS_ERROR':
      return { ...state, aqsError: action.payload };
    case 'SET_HAS_REFRESHED_SESSION':
      return { ...state, hasRefreshedSession: true };

    // ── Compound actions ──────────────────────────────────────────
    // Batches the 13 state resets that happened when selectedState changed
    case 'RESET_FOR_STATE_CHANGE':
      return {
        ...state,
        loading: true,
        allFacilities: [],
        center: null,
        selectedFacility: null,
        activeTab: 'inventory',
        tabBeforeAutoSwitch: null,
        dataSource: '',
        countyData: null,
        classIGeoJson: null,
        showClassI: false,
        aqsMonitors: [],
        showAqsMonitors: false,
        selectedMonitor: null,
        neiData: null,
        selectedSector: null,
      };

    // When a facility is clicked from map or table
    // If on inventory, auto-switch to PSD and remember where we came from
    case 'FACILITY_CLICKED': {
      const autoSwitch = state.activeTab === 'inventory';
      return {
        ...state,
        selectedFacility: action.payload,
        selectedMonitor: null,
        neiData: null,
        activeTab: autoSwitch ? 'psd' : state.activeTab,
        tabBeforeAutoSwitch: autoSwitch ? 'inventory' : state.tabBeforeAutoSwitch,
      };
    }

    // When facility popup closes on the map
    // If we auto-switched from inventory, go back; otherwise stay on current tab
    case 'FACILITY_CLOSED':
      return {
        ...state,
        selectedFacility: null,
        activeTab: state.tabBeforeAutoSwitch || state.activeTab,
        tabBeforeAutoSwitch: null,
      };

    // When monitor popup closes on the map
    case 'MONITOR_CLOSED':
      return {
        ...state,
        selectedMonitor: null,
      };

    // "Clear map pin" button
    case 'CLEAR_MAP_PIN':
      return {
        ...state,
        center: null,
        selectedFacility: null,
        activeTab: 'inventory',
      };

    // "Close Details" / "Deselect" in sidebar
    case 'DESELECT_FACILITY':
      return {
        ...state,
        selectedFacility: null,
        activeTab: 'inventory',
      };

    case 'DESELECT_MONITOR':
      return {
        ...state,
        selectedMonitor: null,
        activeTab: 'inventory',
      };

    case 'MONITOR_SELECTED':
      return {
        ...state,
        selectedFacility: null,
        selectedMonitor: action.payload,
        neiData: null,
      };

    default:
      return state;
  }
}

// ─── Custom hook ───────────────────────────────────────────────────
export function useDashboardReducer() {
  const [state, dispatch] = useReducer(dashboardReducer, initialState);

  // Refs for stale-closure prevention (same pattern as before)
  const selectedStateRef = useRef(state.selectedState);
  const selectedFacilityIdRef = useRef<string | null>(null);
  const selectedMonitorIdRef = useRef<string | null>(null);

  // Keep refs in sync
  if (selectedStateRef.current !== state.selectedState) {
    selectedStateRef.current = state.selectedState;
  }
  if (selectedFacilityIdRef.current !== (state.selectedFacility?.id || null)) {
    selectedFacilityIdRef.current = state.selectedFacility?.id || null;
  }
  if (selectedMonitorIdRef.current !== (state.selectedMonitor?.id || null)) {
    selectedMonitorIdRef.current = state.selectedMonitor?.id || null;
  }

  // Convenience: conditional close handlers that check refs
  const handleFacilityClose = useCallback((closedFacility: Facility) => {
    if (selectedFacilityIdRef.current === closedFacility.id) {
      dispatch({ type: 'FACILITY_CLOSED' });
    }
  }, []);

  const handleMonitorClose = useCallback((closedMonitor: AqsMonitor) => {
    if (selectedMonitorIdRef.current === closedMonitor.id) {
      dispatch({ type: 'MONITOR_CLOSED' });
    }
  }, []);

  return {
    state,
    dispatch,
    refs: { selectedStateRef, selectedFacilityIdRef, selectedMonitorIdRef },
    handleFacilityClose,
    handleMonitorClose,
  };
}
