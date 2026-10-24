# Master Prompt: Build LedgerNepal — A Multi-Tenant Business Ledger Application

Act as a senior software architect, experienced full-stack developer, database designer, and application security engineer. Help me design and build a production-quality web application called **LedgerNepal**, a digital bahi-khata and business ledger platform for small and medium-sized businesses in Nepal.

Do not build a toy project or a superficial UI prototype. I want a well-structured, secure, maintainable application that can eventually be used by real businesses.

Work incrementally, explain important technical decisions, and implement the application in manageable phases. Do not attempt to generate the entire application in one response.

## 1. Technology Stack

Use the following technologies:

**Frontend**
- React
- JavaScript
- Vite
- React Router for navigation
- A consistent, professional UI component and styling approach
- Responsive layouts for desktop, tablet, and mobile

**Backend**
- Node.js
- Express.js
- REST APIs
- Input validation and centralized error handling

**Database**
- PostgreSQL
- Proper relational database design
- Foreign keys, constraints, indexes, and database transactions where appropriate

**Development environment**
- Linux-compatible development workflow
- Environment variables for configuration and secrets
- Database migrations and seed scripts
- Automated tests
- Git-friendly project structure

Prefer straightforward, widely used technologies. Avoid unnecessary frameworks, microservices, complex infrastructure, and paid services unless genuinely required.

## 2. Product Overview

LedgerNepal will be used by multiple independent businesses.

Each business can maintain its own:
- Customers, suppliers, and partners
- Sales and purchases
- Receipts and payments
- Direct ledger entries
- Outstanding balances
- Invoices and transaction records
- Reports and business settings
- Users and permissions

A business may have several users, such as an owner, accountant, and staff member.

**The most important architectural requirement is strict multi-tenant data isolation.** Every business must only access its own data unless an explicitly authorized platform-level function is introduced.

A contact does not need to register on LedgerNepal. Businesses can maintain customers and suppliers as ordinary contact records.

Business-to-business account linking, advanced accounting, inventory, and complex integrations are outside the initial scope.

## 3. Role-Based Access Control (RBAC)

Implement proper role-based access control from the beginning. Do not treat this as a feature to add later.

### Initial roles

1. **Platform Administrator**
   - Manage platform-level operations and business account status.
   - Access platform administration features only.
   - Must not automatically receive unrestricted access to private financial records.

2. **Business Owner**
   - Full control over their own business.
   - Manage business profile, users, permissions, contacts, transactions, and reports.
   - Invite or deactivate business users.
   - Access all permitted business data.

3. **Business Administrator**
   - Manage business users, contacts, and permitted settings.
   - Access business data according to assigned permissions.
   - Cannot transfer ownership or perform owner-exclusive actions unless explicitly authorized.

4. **Accountant**
   - Manage sales, purchases, receipts, payments, ledger entries, and reports according to permissions.

5. **Staff**
   - Perform assigned operational tasks.
   - Cannot manage users, business security settings, or sensitive financial operations without permission.

6. **Viewer**
   - Read-only access to specifically permitted records and reports.

### Permissions

Design permissions around actions and resources, not just role names.

Examples:
- `contacts.view`
- `contacts.create`
- `contacts.update`
- `contacts.archive`
- `sales.view`
- `sales.create`
- `sales.update`
- `sales.void`
- `purchases.view`
- `purchases.create`
- `receipts.view`
- `receipts.create`
- `payments.view`
- `payments.create`
- `ledger.view`
- `ledger.create`
- `ledger.correct`
- `reports.view`
- `reports.export`
- `users.view`
- `users.invite`
- `users.manage`
- `settings.manage`

Build a permission matrix and document the default permissions for each role.

Requirements:
- Enforce authorization on the backend for every protected endpoint.
- Never rely on frontend route hiding as a security mechanism.
- Verify the user's active membership in the requested business.
- Prevent horizontal privilege escalation and cross-business access.
- Prevent users from granting permissions they are not authorized to grant.
- Validate access to individual records, attachments, exports, and related resources.
- Support multiple business memberships for a user.
- Allow the user to select their active business after login when they belong to multiple businesses.
- Enforce account suspension, membership deactivation, and session revocation appropriately.
- Record important administrative and financial actions in an audit log.

Create automated tests proving that a user from Business A cannot read, modify, or delete Business B's records by changing IDs, request bodies, query parameters, or URLs.

## 4. Authentication and Security

Implement:
- User registration and business creation
- Secure login and logout
- Password hashing using Argon2id or an appropriately configured bcrypt implementation
- Secure password reset
- HTTP-only, Secure, SameSite cookies for session authentication where appropriate
- CSRF protection when required by the chosen authentication architecture
- Rate limiting for login and other abuse-prone endpoints
- Server-side validation of all input
- Parameterized database queries
- Protection against SQL injection, XSS, IDOR, and unauthorized data access
- Secure CORS and security headers
- Environment-based secrets and configuration
- Safe error responses without exposing stack traces or credentials
- Audit logging for important security and financial events

Never store passwords in plaintext. Never expose secrets in frontend code, source control, logs, or API responses.

## 5. Contact Management

Businesses should be able to create, view, edit, search, and archive contacts.

Contact fields:
- Name — required
- Contact type — required
- Phone number — optional
- Address — optional
- PAN number — optional
- VAT registration number — optional
- Email — optional
- Notes — optional
- Opening balance — optional, with an explicit balance direction
- Created date and updated date

Contact types:
- Customer
- Supplier
- Partner
- Multiple roles

A contact may have more than one role.

Phone number, address, PAN, VAT number, email, and notes must not be mandatory.

Include:
- Contact listing and search
- Filtering by contact type
- Contact details page
- Individual contact ledger
- Current outstanding balance
- Transaction history
- Clear validation messages

Do not impose uniqueness constraints on optional phone numbers or PAN/VAT fields without a justified business rule.

## 6. Direct Ledger Entries

This is a core feature.

Users must have a dedicated **Add Ledger Entry** option available from:
- The sidebar
- The dashboard
- An individual contact's details or ledger page

Users must be able to record a transaction without creating a formal invoice.

Fields:
- Contact — required
- Transaction date — required
- Entry type or direction — required
- Amount in NPR — required
- Description — optional
- Reference number — optional or system-generated
- Supporting attachment — optional, if implemented
- Created by and created timestamp — system-generated

The interface should make the financial meaning of each entry clear. For example, whether the contact owes the business more money or less money.

Define and document a consistent debit/credit convention. Do not assume that the word "credit" always means money received.

The system must:
- Validate positive monetary amounts.
- Calculate the running balance correctly.
- Update outstanding summaries consistently.
- Generate a unique reference number within the relevant business.
- Record who created or corrected the entry.
- Prevent unauthorized editing and deletion.
- Support a controlled correction or void process for posted entries.
- Preserve audit history.

Opening balances should also be supported.

## 7. Sales and Purchases

### Sales

Allow users to:
- Create a sales transaction or invoice.
- Select an existing contact or add a new one.
- Enter invoice date and invoice number.
- Enter item descriptions, quantity, unit price, discount, taxable amount, and applicable VAT where appropriate.
- Calculate totals.
- Save drafts and post finalized transactions.
- View transaction history.
- Print or export invoices.
- Record outstanding amounts.

### Purchases

Allow users to:
- Record supplier bills.
- Store supplier invoice numbers and dates.
- Enter descriptions, amounts, discounts, and applicable VAT.
- Record total payable amounts.
- Track paid and unpaid balances.
- Link payments to purchases where applicable.

Inventory tracking and automatic stock management are not required.

## 8. Receipts and Payments

Allow users to record money received from contacts and money paid to contacts.

Fields:
- Contact
- Transaction date
- Amount in NPR
- Payment method
- Reference or transaction number
- Description
- Optional notes

Initial payment methods:
- Cash
- Bank transfer
- Cheque
- eSewa
- Khalti
- Other

Support:
- Partial receipts and payments
- Multiple payments against an invoice
- One payment allocated across multiple invoices, if feasible in the MVP
- Unallocated advances
- Payment history
- Printable receipts

Use database transactions to ensure that related records and balance calculations remain consistent.

## 9. Nepali Market Requirements

Design the application for businesses operating in Nepal.

### Currency
- Nepalese Rupee (NPR / रु)
- Consistent currency formatting and decimal precision

### Dates
- Support Gregorian dates (AD) and Bikram Sambat dates (BS).
- Let users choose their preferred date display format.
- Provide a way to enter dates in either supported format.
- Support date-range filters using the selected format.
- Support business reports by Nepal's fiscal year.

Use a reliable BS–AD conversion library or a well-tested conversion implementation. Verify leap years, month lengths, year boundaries, and historical dates.

Store canonical dates consistently in the database, normally using PostgreSQL date values for business dates. Convert dates for display and input at the application boundary. Do not store an ambiguous BS date in a normal AD date column.

Ensure that invoice dates, ledger entries, reports, and printed documents use consistent date semantics.

### PAN and VAT
- Store the business PAN number.
- Store the VAT registration number when applicable.
- Support contact PAN/VAT details.
- Support configurable tax settings for sales and purchases.
- Clearly distinguish taxable amount, tax amount, and total.
- Do not hardcode an assumed VAT rate for every transaction.
- Do not force every business to register for VAT.

Implement basic VAT-aware transaction fields, but do not attempt full tax filing or regulatory integrations in the MVP. Verify Nepal's current tax and invoice rules before claiming that generated documents are legally compliant.

### Language and documents
- English interface initially.
- Structure the UI so Nepali-language support can be added later.
- Use fonts that support Nepali script in printed documents if Nepali text is supported.
- Print business name, address, PAN/VAT information when available, invoice number, date, line items, and totals as appropriate.

## 10. Dashboard

Create a clean, professional dashboard containing:
- Total sales for the selected period
- Total purchases
- Receipts
- Payments
- Outstanding receivables
- Outstanding payables
- Overdue balances
- Recent transactions
- Quick actions

Quick actions must include:
- Add Contact
- Add Ledger Entry
- Create Sales Invoice
- Record Purchase
- Record Receipt
- Record Payment

All figures must be derived from actual authorized database records, not hardcoded examples.

Allow date filtering, with BS/AD support.

## 11. Ledger and Reports

### Contact ledger

Display:
- Transaction date
- Reference number
- Description
- Debit
- Credit
- Running balance
- Transaction type
- Creator where permitted

Include:
- Opening balance
- Closing balance
- Date filters
- Search
- Pagination
- PDF/CSV export
- Print-friendly layout

### Reports

Initial reports:
- Customer-wise ledger
- Supplier-wise ledger
- Daily and monthly sales
- Purchases
- Receipts and payments
- Outstanding receivables
- Outstanding payables
- Overdue balances

Avoid building advanced accounting statements, inventory reports, or full profit-and-loss reporting until the necessary accounting data and rules exist.

## 12. UI and UX Design

Create a professional, simple, modern business application.

Visual direction:
- Dark navy sidebar
- White content area
- Blue primary buttons
- Clear typography
- Consistent spacing
- Responsive tables
- Clean forms
- Rounded cards used sparingly
- Clear loading, empty, success, and error states

Main navigation:
1. Dashboard
2. Contacts
3. Sales
4. Purchases
5. Receipts & Payments
6. Ledger
7. Reports
8. Settings

The Ledger section must offer both:
- View Ledger
- Add Ledger Entry

Also provide contextual Add Entry actions from contact pages and a dashboard quick action.

Every page should be a working React page connected to the backend, not merely a static visual mockup.

## 13. Database Architecture

Design normalized PostgreSQL tables, including at least:
- `users`
- `businesses`
- `business_users`
- `roles` and `permissions`, or an equally robust RBAC model
- `contacts`
- `transactions`
- `transaction_lines`
- `payment_allocations`
- `audit_logs`

Add other tables when justified, such as sessions, invitations, or attachments.

Requirements:
- Use UUIDs or another consistent non-guessable identifier strategy.
- Include `business_id` on business-owned entities where appropriate.
- Add foreign keys and appropriate indexes.
- Enforce business-consistent relationships in the database where feasible.
- Use `NUMERIC` for monetary amounts, never floating-point types for currency.
- Use explicit transaction types and statuses.
- Use database transactions for multi-record financial operations.
- Define how opening balances, posted entries, voids, partial payments, and running balances work.
- Avoid storing the same financial balance independently in multiple places without a consistency strategy.
- Include creation/update timestamps and audit information.
- Provide versioned database migrations and seed data.

Before implementation, explain the schema and the relationships between entities. Identify important accounting assumptions and ask me about genuinely ambiguous business rules rather than silently inventing them.

## 14. API Design

Create REST endpoints with consistent naming, validation, authentication, authorization, pagination, filtering, and error responses.

Expected endpoint groups include:
- `/api/auth`
- `/api/businesses`
- `/api/users`
- `/api/contacts`
- `/api/ledger`
- `/api/sales`
- `/api/purchases`
- `/api/receipts`
- `/api/payments`
- `/api/reports`
- `/api/settings`

Use the authenticated user's active business membership as the authorization basis. Never trust a client-supplied `business_id` without checking membership and permissions.

Document the APIs and their permission requirements. Use consistent status codes and error formats.

## 15. Testing and Quality

Implement tests as features are developed.

Include:
- Unit tests for business rules and date conversion
- API integration tests
- Database constraint tests
- Authentication tests
- RBAC tests for every role
- Cross-tenant isolation tests
- Financial calculation tests
- Partial-payment and allocation tests
- Input validation tests
- Tests for BS/AD date boundaries
- Tests for unauthorized edits and voids

Test cases must cover both successful and rejected requests.

Do not claim that a feature is complete unless it has been implemented and the relevant tests pass.

## 16. Development Workflow — Very Important

Do not generate the entire application in one massive response.

Follow this process:

**Phase 1: Requirements and architecture**
1. Summarize the requirements.
2. Identify assumptions and unresolved accounting rules.
3. Propose the project folder structure.
4. Design the database schema and relationships.
5. Define the RBAC permission matrix.
6. Explain the authentication and multi-tenant security model.
7. Propose a prioritized implementation plan.

**Phase 2: Project foundation**
1. Set up React/Vite.
2. Set up Express.
3. Configure PostgreSQL.
4. Create database migrations.
5. Add environment configuration.
6. Add health-check endpoints.
7. Configure validation, error handling, logging, and tests.

**Phase 3: Authentication and authorization**
1. Implement registration and login.
2. Implement business membership.
3. Implement roles and permissions.
4. Add protected frontend routes.
5. Enforce backend permissions.
6. Write tenant-isolation tests before adding financial functionality.

**Phase 4: Core business features**
1. Contact management
2. Direct ledger entries
3. Sales and purchases
4. Receipts and payments
5. Running balances and payment allocations
6. Dashboard and reports
7. Printing and export
8. Business settings and BS/AD support

**Phase 5: Hardening**
1. Review authorization gaps.
2. Test financial consistency.
3. Test edge cases.
4. Improve usability and responsive design.
5. Document installation, deployment, backup, and recovery procedures.

At the end of each phase, summarize what was completed, what files changed, how to run it, and how to test it.

## 17. Rules for Working With Me

- Assume I am building this incrementally and want to understand the implementation.
- Give beginner-friendly, step-by-step commands when setup is involved.
- When modifying existing code, inspect the current code first and preserve working functionality.
- Never invent existing files, dependencies, or test results.
- Provide complete, runnable code for the specific files being implemented.
- Explain where each file belongs.
- Give exact terminal commands for installation, migrations, running the application, and tests.
- Use safe database migrations; do not casually drop tables or delete existing data.
- Keep frontend and backend responsibilities clearly separated.
- Do not put business logic entirely in React.
- Do not bypass RBAC for convenience.
- Do not use fake success messages for operations that are not connected to the backend.
- Keep advanced features out of the MVP unless they are essential for correctness or security.
- Do not introduce AWS, Kubernetes, microservices, or other unnecessary infrastructure.
- If working in an existing repository, inspect it before proposing or changing its structure.
- If an important requirement is ambiguous, ask a concise clarification question before making a risky architectural decision.

## 18. Your First Task

**Do not start coding yet.**

First, give me:

1. A concise summary of the application.
2. A recommended architecture diagram.
3. The complete proposed database schema and relationships.
4. A role-permission matrix.
5. The proposed API endpoint list.
6. A prioritized MVP feature list.
7. A security checklist focusing on RBAC and multi-tenant isolation.
8. A phased implementation plan.

Keep the initial product simple but architect it correctly so that new features can be added later without major rewrites.

After I review and approve the architecture, proceed with Phase 2 and guide me through implementation one step at a time.