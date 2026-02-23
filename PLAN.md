# Homatt Health - Dashboard & Features Implementation Plan

## Current State
- Vanilla HTML/CSS/JS app (no frameworks)
- Signup page fully built with Material Design styling
- Green/orange color theme, mobile-first (393x852 phone frame)
- No routing, no backend, no sign-in page yet

---

## Phase 0: Foundation (Build First)
> Required before any feature work

### 0.1 - Sign-In Page
- Create `signin.html` with phone + password login form
- Link from signup success → sign-in, and sign-in → signup
- Store user data in localStorage for now (simulate auth)

### 0.2 - Dashboard Shell & Navigation
- Create `dashboard.html` with bottom tab bar (Home, Family, Wallet, Profile)
- Build a reusable bottom nav component
- Add top header bar with user greeting + notification bell
- Route sign-in success → dashboard

---

## Phase 1: Symptom Checker ("Check My Health")
> The main dashboard hero feature

- Prominent card/button on dashboard home
- Multi-step symptom input flow:
  1. Select body area (head, chest, stomach, etc.)
  2. Pick symptoms from categorized list
  3. Rate severity (mild/moderate/severe)
  4. Duration selector
- Results screen with:
  - Possible conditions (informational, not diagnostic)
  - Recommended action (rest, see doctor, emergency)
  - Nearest facility suggestion
- Save symptom log to localStorage with timestamp

---

## Phase 2: Family Tab & Dependants
> Bottom tab: "Family"

### 2.1 - Family Members List
- Show list of dependants (from signup family data)
- "Add Dependant" button → form (name, age, sex, relationship)
- Each member shows avatar, name, age, relationship badge

### 2.2 - Dependant Health Status & Logs
- Tap a family member → their health profile
- Health status summary (last check, active conditions)
- Health log timeline (symptom checks, vitals logged)
- Ability to run symptom checker on behalf of dependant

---

## Phase 3: Wallets (Family Wallet & Care Wallet)
> Inside Family tab + dedicated wallet section

### 3.1 - Wallet Dashboard
- Two wallet cards: **Family Wallet** + **Care Wallet**
- Each shows balance, last transaction, mini chart
- Visual money breakdown (pie/bar chart using CSS)

### 3.2 - Deposit & Transactions
- Deposit flow: amount input → confirm → success animation
- Transaction to healthcare facility:
  - Select facility from list
  - Enter amount + purpose (consultation, medicine, lab)
  - Confirmation screen → receipt
- Transaction history list with filters

---

## Phase 4: Daily Reminders & Preventive Care Tips
> Dashboard home cards

- Daily tip card on dashboard (rotates daily)
- Tips categories: nutrition, hygiene, exercise, mental health
- Reminder system:
  - Medication reminders
  - Appointment reminders
  - Health check reminders
- Notification-style cards with dismiss/snooze

---

## Phase 5: Menstrual Cycle Tracker
> Health section feature (for female users)

- Calendar view with cycle visualization
- Log period start/end dates
- Predict next period + fertile window
- Symptom logging (cramps, mood, flow level)
- Cycle history and insights

---

## Phase 6: Child Growth Tracker
> Family tab feature (for families with children)

- Select child from family members
- Log: weight, height, head circumference, date
- Growth chart visualization (WHO standards reference)
- Milestone checklist by age
- Growth history timeline

---

## Phase 7: Pregnancy Tracker
> Health section feature

- Set due date / last menstrual period
- Week-by-week progress display
- Current week info (baby size, development)
- Symptom & appointment logging
- Kick counter
- Weight tracking during pregnancy

---

## Phase 8: Malaria Risk Alert
> Dashboard alert card

- Risk level indicator (low/medium/high) based on region + season
- Prevention tips (nets, repellent, standing water)
- Symptom awareness checklist
- "I think I have malaria" quick-check flow
- Nearest testing facility link
- Regional risk data (hardcoded by Uganda district)

---

## Phase 9: Blood Pressure Logger & Tracker
> Health section feature

- Log readings: systolic, diastolic, pulse, date/time
- Classification display (normal, elevated, hypertension stages)
- History chart (line graph over time)
- Trends & averages (7-day, 30-day)
- Alert if readings are dangerously high/low

---

## Phase 10: Daily Health Quiz
> Dashboard engagement feature

- Daily quiz card on dashboard
- 3-5 questions per day on health topics
- Multiple choice with immediate feedback
- Explanation after each answer
- Score tracking + streak counter
- Topics: nutrition, disease prevention, first aid, maternal health, child care

---

## Implementation Order Summary

| # | Feature | Priority | Depends On |
|---|---------|----------|------------|
| 0.1 | Sign-In Page | CRITICAL | - |
| 0.2 | Dashboard Shell + Nav | CRITICAL | 0.1 |
| 1 | Symptom Checker | HIGH | 0.2 |
| 2 | Family Tab + Dependants | HIGH | 0.2 |
| 3 | Wallets | HIGH | 2 |
| 4 | Daily Reminders & Tips | MEDIUM | 0.2 |
| 5 | Menstrual Cycle Tracker | MEDIUM | 0.2 |
| 6 | Child Growth Tracker | MEDIUM | 2 |
| 7 | Pregnancy Tracker | MEDIUM | 0.2 |
| 8 | Malaria Risk Alert | MEDIUM | 0.2 |
| 9 | Blood Pressure Logger | MEDIUM | 0.2 |
| 10 | Daily Health Quiz | LOW | 0.2 |

---

## Tech Notes
- All vanilla HTML/CSS/JS (no frameworks)
- localStorage for data persistence
- Separate HTML file per major screen
- Shared CSS variables and component styles
- Mobile-first, same phone-frame design pattern
