import { createContext, useContext, useReducer, useEffect } from 'react';

const AppContext = createContext(null);

const initialState = {
  currentUser: null,
  currentProject: null, // explicitly set by navigating to a project
  projects: [],
  emails: [],
  theme: 'dark',
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
    theme: 'dark',
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
  },
};

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
      return { ...state, emails: action.payload };
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
      const theme = action.payload;
      if (theme === 'light') document.body.classList.add('light');
      else document.body.classList.remove('light');
      return { ...state, theme };
    }
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };
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

  // Persist settings to localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ely5_settings') || '{}');
      if (saved && Object.keys(saved).length > 0) {
        dispatch({ type: 'SET_SETTINGS', payload: saved });
        if (saved.theme) dispatch({ type: 'SET_THEME', payload: saved.theme });
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ely5_settings', JSON.stringify(state.settings));
    } catch (e) {}
  }, [state.settings]);

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
