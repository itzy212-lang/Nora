# Nora — Native App Build Guide (Capacitor)

## Setup (one-time)

```bash
npm install
npx cap init  # only needed once if android/ios folders don't exist
npx cap add android
npx cap add ios  # Mac only
```

## Building for Android

Requirements: Android Studio installed

```bash
npm run cap:android
```

This will:
1. Build the web app (vite build)
2. Sync into the Android native project
3. Open Android Studio

In Android Studio: Build → Generate Signed APK/AAB → upload to Play Store.

## Building for iOS

Requirements: Mac with Xcode + Apple Developer account (£79/year)

```bash
npm run cap:ios
```

This will:
1. Build the web app
2. Sync into the iOS native project  
3. Open Xcode

In Xcode: Product → Archive → Distribute to App Store.

## App Details
- App ID: co.sq1consulting.nora
- App Name: Nora
- Bundle output: dist/

## Push Notifications Setup (when ready)
1. Android: Create Firebase project → download google-services.json → place in android/app/
2. iOS: Enable Push Notifications capability in Xcode → upload APNs key to Firebase

## Updating the app
After any code change:
```bash
npm run cap:sync
```
Then rebuild from Android Studio / Xcode.
