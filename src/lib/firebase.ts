import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firestore with the specific databaseId if provided, else (default)
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || "(default)");

export { db };
