/**
 * Homatt Health — Wallet Page
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Auth check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'signin.html'; return; }

  const userId = session.user.id;

  // Status bar time
  function updateTime() {
    const n = new Date();
    document.getElementById('statusTime').textContent =
      `${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // ====== State ======
  let walletData = { family_balance: 0, care_balance: 0 };
  let transactions = [];
  let addMoneyWalletType = 'family';
  let transferDir = 'family_to_care'; // 'family_to_care' | 'care_to_family'

  // ====== Load wallet ======
  async function loadWallet() {
    const { data: w } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (w) {
      walletData = w;
    } else {
      // Create wallet record for first-time user
      await supabase.from('wallets').insert({ user_id: userId, family_balance: 0, care_balance: 0 });
    }

    renderBalances();
    await loadTransactions();
  }

  function renderBalances() {
    const family = walletData.family_balance || 0;
    const care = walletData.care_balance || 0;
    const total = family + care;

    document.getElementById('totalBalance').textContent = total.toLocaleString();
    document.getElementById('familyBalanceCard').textContent = family.toLocaleString();
    document.getElementById('careBalanceCard').textContent = care.toLocaleString();

    // Sync localStorage for dashboard wallet preview
    localStorage.setItem('homatt_wallets', JSON.stringify({ family, care }));
  }

  // ====== Load transactions ======
  async function loadTransactions() {
    const { data: txns } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    transactions = txns || [];
    renderTransactions();
  }

  function renderTransactions() {
    const listEl = document.getElementById('txnList');
    if (transactions.length === 0) {
      listEl.innerHTML = `
        <div class="txn-empty">
          <span class="material-icons-outlined">receipt_long</span>
          No transactions yet
        </div>`;
      return;
    }

    listEl.innerHTML = transactions.map(txn => {
      const isCredit = txn.type === 'credit';
      const dateStr = new Date(txn.created_at).toLocaleDateString('en-UG', { month: 'short', day: 'numeric' });
      const sign = isCredit ? '+' : '-';
      return `
        <div class="txn-item">
          <div class="txn-icon-wrap ${txn.type}">
            <span class="material-icons-outlined">${isCredit ? 'arrow_downward' : 'arrow_upward'}</span>
          </div>
          <div class="txn-body">
            <div class="txn-desc">${escHtml(txn.description || 'Transaction')}</div>
            <div class="txn-date">${dateStr}</div>
            <span class="txn-wallet-badge ${txn.wallet_type}">${txn.wallet_type === 'family' ? 'Family Wallet' : 'Care Wallet'}</span>
          </div>
          <div class="txn-amount ${txn.type}">${sign}UGX ${Number(txn.amount).toLocaleString()}</div>
        </div>`;
    }).join('');
  }

  await loadWallet();

  // ====== Sheet helpers ======
  const overlay = document.getElementById('sheetOverlay');
  const addMoneySheet = document.getElementById('addMoneySheet');
  const transferSheet = document.getElementById('transferSheet');

  function openSheet(sheet) {
    overlay.classList.add('visible');
    sheet.classList.add('open');
  }
  function closeAllSheets() {
    overlay.classList.remove('visible');
    [addMoneySheet, transferSheet].forEach(s => s.classList.remove('open'));
  }

  overlay.addEventListener('click', closeAllSheets);
  document.getElementById('closeAddMoneySheet').addEventListener('click', closeAllSheets);
  document.getElementById('closeTransferSheet').addEventListener('click', closeAllSheets);

  // ====== Open Add Money ======
  function openAddMoney(walletType) {
    addMoneyWalletType = walletType;
    document.getElementById('addMoneySheetTitle').textContent =
      `Add to ${walletType === 'family' ? 'Family' : 'Care'} Wallet`;
    document.getElementById('wtFamily').classList.toggle('selected', walletType === 'family');
    document.getElementById('wtCare').classList.toggle('selected', walletType === 'care');
    document.getElementById('depositAmount').value = '';
    document.getElementById('depositDesc').value = '';
    openSheet(addMoneySheet);
  }

  document.getElementById('addMoneyFamilyBtn').addEventListener('click', () => openAddMoney('family'));
  document.getElementById('addMoneyCareBtn').addEventListener('click', () => openAddMoney('care'));

  // Wallet type toggle inside sheet
  document.getElementById('wtFamily').addEventListener('click', () => {
    addMoneyWalletType = 'family';
    document.getElementById('wtFamily').classList.add('selected');
    document.getElementById('wtCare').classList.remove('selected');
    document.getElementById('addMoneySheetTitle').textContent = 'Add to Family Wallet';
  });
  document.getElementById('wtCare').addEventListener('click', () => {
    addMoneyWalletType = 'care';
    document.getElementById('wtCare').classList.add('selected');
    document.getElementById('wtFamily').classList.remove('selected');
    document.getElementById('addMoneySheetTitle').textContent = 'Add to Care Wallet';
  });

  // Quick amount chips
  document.querySelectorAll('.quick-amt').forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = parseInt(btn.dataset.amount);
      document.getElementById('depositAmount').value = amt;
      document.querySelectorAll('.quick-amt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Confirm deposit
  document.getElementById('confirmDepositBtn').addEventListener('click', async () => {
    const amount = parseInt(document.getElementById('depositAmount').value);
    if (!amount || amount < 500) { showToast('Enter an amount (min UGX 500)'); return; }

    const desc = document.getElementById('depositDesc').value.trim() || `Deposit to ${addMoneyWalletType} wallet`;

    const btn = document.getElementById('confirmDepositBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 1s linear infinite">refresh</span> Recording...';

    // Insert transaction
    const { error: txnErr } = await supabase.from('wallet_transactions').insert({
      user_id: userId,
      wallet_type: addMoneyWalletType,
      type: 'credit',
      amount,
      description: desc,
    });

    if (txnErr) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined">add_circle</span> Record Deposit';
      showToast('Failed to record. Try again.');
      return;
    }

    // Update wallet balance
    const field = addMoneyWalletType === 'family' ? 'family_balance' : 'care_balance';
    const newBal = (walletData[field] || 0) + amount;

    await supabase.from('wallets').upsert({
      user_id: userId,
      [field]: newBal,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    walletData[field] = newBal;
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">add_circle</span> Record Deposit';

    renderBalances();
    await loadTransactions();
    closeAllSheets();
    showToast(`UGX ${amount.toLocaleString()} added to ${addMoneyWalletType === 'family' ? 'Family' : 'Care'} Wallet!`);
  });

  // ====== Transfer Sheet ======
  document.getElementById('transferBtn').addEventListener('click', () => openSheet(transferSheet));

  document.getElementById('transferFtC').addEventListener('click', () => {
    transferDir = 'family_to_care';
    document.getElementById('transferFtC').classList.add('selected');
    document.getElementById('transferCtF').classList.remove('selected');
  });
  document.getElementById('transferCtF').addEventListener('click', () => {
    transferDir = 'care_to_family';
    document.getElementById('transferCtF').classList.add('selected');
    document.getElementById('transferFtC').classList.remove('selected');
  });

  document.getElementById('confirmTransferBtn').addEventListener('click', async () => {
    const amount = parseInt(document.getElementById('transferAmount').value);
    if (!amount || amount < 500) { showToast('Enter an amount (min UGX 500)'); return; }

    const fromWallet = transferDir === 'family_to_care' ? 'family' : 'care';
    const toWallet = transferDir === 'family_to_care' ? 'care' : 'family';
    const fromField = fromWallet + '_balance';
    const toField = toWallet + '_balance';

    if ((walletData[fromField] || 0) < amount) {
      showToast(`Insufficient balance in ${fromWallet === 'family' ? 'Family' : 'Care'} Wallet`);
      return;
    }

    const btn = document.getElementById('confirmTransferBtn');
    btn.disabled = true;

    // Two transactions (debit + credit)
    await Promise.all([
      supabase.from('wallet_transactions').insert({
        user_id: userId, wallet_type: fromWallet, type: 'debit', amount,
        description: `Transfer to ${toWallet} wallet`,
      }),
      supabase.from('wallet_transactions').insert({
        user_id: userId, wallet_type: toWallet, type: 'credit', amount,
        description: `Transfer from ${fromWallet} wallet`,
      }),
    ]);

    // Update balances
    const newFrom = (walletData[fromField] || 0) - amount;
    const newTo = (walletData[toField] || 0) + amount;

    await supabase.from('wallets').upsert({
      user_id: userId,
      [fromField]: newFrom,
      [toField]: newTo,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    walletData[fromField] = newFrom;
    walletData[toField] = newTo;
    btn.disabled = false;

    renderBalances();
    await loadTransactions();
    closeAllSheets();
    showToast(`UGX ${amount.toLocaleString()} transferred successfully!`);
  });

  // ====== Refresh ======
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await loadWallet();
    showToast('Refreshed');
  });

  // ====== Mobile Money (Relworx) ======
  let momoNetwork = 'MTN'; // 'MTN' | 'AIRTEL'
  let momoWalletType = 'family';
  let momoPollingInterval = null;

  const momoSheet = document.getElementById('momoSheet');

  function openMomoSheet(network) {
    momoNetwork = network;
    document.getElementById('momoSheetTitle').textContent = `Pay with ${network === 'MTN' ? 'MTN Mobile Money' : 'Airtel Money'}`;
    document.getElementById('momoPhoneHint').textContent =
      network === 'MTN' ? 'Enter your MTN number e.g. 0772 123 456' : 'Enter your Airtel number e.g. 0752 123 456';
    document.getElementById('momoPhone').value = '';
    document.getElementById('momoAmount').value = '';
    document.getElementById('momoStatusArea').style.display = 'none';
    document.getElementById('momoSubmitBtn').disabled = false;
    document.getElementById('momoSubmitLabel').textContent = 'Request Payment';
    document.querySelectorAll('.momo-quick-amt').forEach(b => b.classList.remove('selected'));
    openSheet(momoSheet);
  }

  document.getElementById('mtnBtn').addEventListener('click', () => openMomoSheet('MTN'));
  document.getElementById('airtelBtn').addEventListener('click', () => openMomoSheet('AIRTEL'));
  document.getElementById('closeMomoSheet').addEventListener('click', () => {
    clearMomoPolling();
    closeAllSheets();
  });

  // Wallet selector inside momo sheet
  document.getElementById('momoWtFamily').addEventListener('click', () => {
    momoWalletType = 'family';
    document.getElementById('momoWtFamily').classList.add('selected');
    document.getElementById('momoWtCare').classList.remove('selected');
  });
  document.getElementById('momoWtCare').addEventListener('click', () => {
    momoWalletType = 'care';
    document.getElementById('momoWtCare').classList.add('selected');
    document.getElementById('momoWtFamily').classList.remove('selected');
  });

  // Quick amounts for momo
  document.querySelectorAll('.momo-quick-amt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('momoAmount').value = btn.dataset.amount;
      document.querySelectorAll('.momo-quick-amt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Submit mobile money payment request
  document.getElementById('momoSubmitBtn').addEventListener('click', async () => {
    const rawPhone = document.getElementById('momoPhone').value.trim();
    const amount   = parseInt(document.getElementById('momoAmount').value);

    if (!rawPhone) { showToast('Please enter your mobile money number'); return; }
    if (!amount || amount < 500) { showToast('Minimum amount is UGX 500'); return; }

    const btn = document.getElementById('momoSubmitBtn');
    btn.disabled = true;
    document.getElementById('momoSubmitLabel').textContent = 'Sending request…';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const anonKey = cfg.SUPABASE_ANON_KEY;
      const fnUrl   = `${cfg.SUPABASE_URL.replace('/rest/v1','')}/functions/v1/relworx-payment`;

      const resp = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || anonKey}`,
        },
        body: JSON.stringify({
          action: 'collect',
          msisdn: rawPhone,
          amount,
          walletType: momoWalletType,
          description: `Homatt ${momoWalletType} wallet top-up via ${momoNetwork}`,
        }),
      });

      const result = await resp.json();

      if (!resp.ok || !result.success) {
        showToast(result.error || 'Payment request failed. Please try again.');
        btn.disabled = false;
        document.getElementById('momoSubmitLabel').textContent = 'Request Payment';
        return;
      }

      // Show waiting state
      document.getElementById('momoStatusArea').style.display = 'block';
      document.getElementById('momoSubmitLabel').textContent = 'Waiting for approval…';

      // Poll for status every 8 seconds for up to 3 minutes
      let elapsed = 0;
      const totalWait = 180;
      momoPollingInterval = setInterval(async () => {
        elapsed += 8;
        document.getElementById('momoStatusTimer').textContent =
          `Waiting ${elapsed}s of max ${totalWait}s…`;

        if (elapsed >= totalWait) {
          clearMomoPolling();
          showToast('Payment not confirmed yet — check your phone and try again');
          btn.disabled = false;
          document.getElementById('momoSubmitLabel').textContent = 'Request Payment';
          document.getElementById('momoStatusArea').style.display = 'none';
          return;
        }

        try {
          const statusResp = await fetch(fnUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || anonKey}`,
            },
            body: JSON.stringify({ action: 'status', internalReference: result.internalReference }),
          });
          const statusData = await statusResp.json();
          const txStatus = statusData?.transaction?.status;

          if (txStatus === 'successful' || txStatus === 'completed') {
            clearMomoPolling();
            closeAllSheets();
            await loadWallet();
            showToast(`UGX ${amount.toLocaleString()} added to ${momoWalletType === 'family' ? 'Family' : 'Care'} Wallet!`);
          } else if (txStatus === 'failed' || txStatus === 'cancelled') {
            clearMomoPolling();
            showToast('Payment was not completed. Please try again.');
            btn.disabled = false;
            document.getElementById('momoSubmitLabel').textContent = 'Request Payment';
            document.getElementById('momoStatusArea').style.display = 'none';
          }
        } catch(e) { /* network error during polling — keep trying */ }
      }, 8000);

    } catch(e) {
      showToast('Network error. Please check your connection and try again.');
      btn.disabled = false;
      document.getElementById('momoSubmitLabel').textContent = 'Request Payment';
    }
  });

  function clearMomoPolling() {
    if (momoPollingInterval) { clearInterval(momoPollingInterval); momoPollingInterval = null; }
  }

  // Card placeholder
  document.getElementById('cardBtn').addEventListener('click', () => {
    showToast('Card payments coming soon!');
  });

  // ====== Toast ======
  function showToast(msg) {
    const t = document.getElementById('walletToast');
    t.textContent = msg;
    t.classList.add('visible');
    setTimeout(() => t.classList.remove('visible'), 2800);
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
});
