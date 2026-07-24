import { createContext, useContext, useReducer, useEffect } from 'react';

const AppContext = createContext(null);

function getSavedSettings() {
  try {
    return JSON.parse(localStorage.getItem('ely5_settings') || '{}');
  } catch {
    return {};
  }
}

function getExplicitThemePreference() {
  try {
    return localStorage.getItem('ely_theme_preference') || '';
  } catch {
    return '';
  }
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return;

  if (theme === 'dark') {
    document.body.classList.remove('light');
  } else {
    document.body.classList.add('light');
  }
}

const savedSettings = typeof window !== 'undefined' ? getSavedSettings() : {};
const explicitTheme = typeof window !== 'undefined' ? getExplicitThemePreference() : '';
const savedTheme = explicitTheme === 'dark' || explicitTheme === 'light' ? explicitTheme : 'light';

const initialState = {
  currentUser: null,
  currentProject: null,
  projects: [],
  leads: [],
  emails: [],
  theme: savedTheme,
  chatSessions: {},
  settings: {
    role: 'partywall',
    name: '',
    firm: '',
    title: '',
    address: '',
    phone: '',
    mobile: '',
    email: '',
    website: '',
    fee: '200',
    hourlyRate: '150',
    socFee: '300',
    agreedFee: '600',
    boDissentFee: '800',
    logoData: '',
    brandColour: '#4f7fff',
    sigType: 'built',
    googleReview: '',
    reviewTiming: '3',
    projPrefix: 'ELY',
    invoicePrefix: 'INV',
    invoiceStartNum: 1,
    nextInvoiceNum: 1,
    bankName: '',
    sortCode: '',
    accountNo: '',
    vatRegistered: false,
    vatRate: 20,
    paymentTerms: 14,
    sigName: '',
    sigQuals: '',
    sigPhone: '',
    sigEmail: '',
    sigAddress: '',
    sigDisclaimer: '',
    sigFirmLogoData: '',
    ...savedSettings,
    theme: savedTheme,
  },
};

applyTheme(savedTheme);

function reducer(state, action) {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, currentUser: action.payload };

    case 'SET_CURRENT_PROJECT':
      return { ...state, currentProject: action.payload };

    case 'CLEAR_CURRENT_PROJECT':
      return { ...state, currentProject: null };

    case 'SET_PROJECTS':
      return { ...state, projects: action.payload };

    case 'UPDATE_PROJECT': {
      const updated = state.projects.map(p =>
        p.id === action.payload.id ? { ...p, ...action.payload } : p
      );
      const cp = state.currentProject?.id === action.payload.id
        ? { ...state.currentProject, ...action.payload }
        : state.currentProject;
      return { ...state, projects: updated, currentProject: cp };
    }

    case 'ADD_PROJECT':
      return { ...state, projects: [action.payload, ...state.projects] };

    case 'REMOVE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter(p => p.id !== action.payload),
        currentProject: state.currentProject?.id === action.payload ? null : state.currentProject,
      };

    case 'SET_EMAILS':
      return { ...state, emails: action.payload, emailsLoadedAt: Date.now() };
    case 'SET_LEADS':
      return { ...state, leads: action.payload };

    case 'ADD_EMAIL':
      return { ...state, emails: [action.payload, ...state.emails] };

    case 'UPDATE_EMAIL': {
      const updatedEmails = state.emails.map(e =>
        (e.id === action.payload.id || e.external_id === action.payload.external_id)
          ? { ...e, ...action.payload }
          : e
      );
      return { ...state, emails: updatedEmails };
    }

    case 'SET_THEME': {
      const theme = action.payload === 'dark' ? 'dark' : 'light';

      try {
        localStorage.setItem('ely_theme_preference', theme);
      } catch {}

      applyTheme(theme);

      return {
        ...state,
        theme,
        settings: {
          ...state.settings,
          theme,
        },
      };
    }

    case 'SET_SETTINGS': {
      const incoming = { ...action.payload };
      const explicit = getExplicitThemePreference();
      const theme = explicit === 'dark' || explicit === 'light'
        ? explicit
        : state.theme || 'light';

      const nextSettings = {
        ...state.settings,
        ...incoming,
        theme,
      };

      applyTheme(theme);

      return {
        ...state,
        settings: nextSettings,
        theme,
      };
    }

    case 'SET_CHAT_SESSION':
      return {
        ...state,
        chatSessions: {
          ...state.chatSessions,
          [action.payload.key]: action.payload.sessionId,
        },
      };

    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    applyTheme(state.theme || 'light');
  }, [state.theme]);

  useEffect(() => {
    try {
      localStorage.setItem('ely5_settings', JSON.stringify({
        ...state.settings,
        theme: state.theme || 'light',
      }));
    } catch {}
  }, [state.settings, state.theme]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
