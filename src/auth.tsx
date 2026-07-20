import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  type User as FirebaseUser
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);

let firebaseApp: FirebaseApp | null = null;
if (hasFirebaseConfig) {
  firebaseApp = initializeApp(firebaseConfig);
}

interface AuthContextValue {
  isReady: boolean;
  isAuthEnabled: boolean;
  user: FirebaseUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useMemo(() => firebaseApp ? getAuth(firebaseApp) : null, []);
  const [isReady, setIsReady] = useState(!auth);
  const [user, setUser] = useState<FirebaseUser | null>(null);

  React.useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, nextUser => {
      setUser(nextUser);
      setIsReady(true);
    });
  }, [auth]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error("Firebase Auth is not configured.");
    await signInWithEmailAndPassword(auth, email, password);
  }, [auth]);

  const signOut = useCallback(async () => {
    if (!auth) return;
    await firebaseSignOut(auth);
  }, [auth]);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!auth) throw new Error("Firebase Auth is not configured.");
    await sendPasswordResetEmail(auth, email);
  }, [auth]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!auth) throw new Error("Firebase Auth is not configured.");
    const currentUser = auth.currentUser;
    if (!currentUser?.email) throw new Error("Authenticated user email is not available.");
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
  }, [auth]);

  const getIdToken = useCallback(async () => user ? user.getIdToken() : null, [user]);

  return (
    <AuthContext.Provider value={{ isReady, isAuthEnabled: !!auth, user, signIn, signOut, sendPasswordReset, changePassword, getIdToken }}>
      {children}
    </AuthContext.Provider>
  );
}
