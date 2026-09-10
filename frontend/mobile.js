let activePaymentId = null;

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('login-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-auth-btn');
            btn.disabled = true;
            btn.textContent = 'Verifying...';
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            try {
                if (!window.supabase || !window.supabase.auth) {
                    throw new Error('Supabase not initialized. Please reload the app.');
                }

                const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                
                await verifyRoleAndLoad(data.user.id);
                document.getElementById('login-overlay').style.display = 'none';
            } catch (err) {
                const errDiv = document.getElementById('login-error');
                errDiv.textContent = err.message;
                errDiv.classList.remove('d-none');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Sign In';
            }
        });
    }

    await checkAuth();
});

async function checkAuth() {
    if (!window.supabase || !window.supabase.auth) {
        document.getElementById('login-overlay').style.display = 'flex';
        return;
    }

    const { data: { session } } = await window.supabase.auth.getSession();
    if (session) {
        document.getElementById('login-overlay').style.display = 'none';
        await verifyRoleAndLoad(session.user.id);
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
    }
}

let currentStaffRole = null;

async function verifyRoleAndLoad(userId) {
    // Check RBAC table
    const { data: staff, error } = await window.supabase
        .from('staff_users')
        .select('role')
        .eq('id', userId)
        .single();
        
    if (error || !staff) {
        alert("Access Denied: You do not have an active staff role.");
        await window.supabase.auth.signOut();
        document.getElementById('login-overlay').style.display = 'flex';
        return;
    }
    
    currentStaffRole = staff.role;
    
    // Admins and Customer Care Agents can access the mobile app
    if (currentStaffRole !== 'Admin' && currentStaffRole !== 'Customer Care Agent') {
        alert("Access Denied: Role not authorized for Mobile App.");
        await window.supabase.auth.signOut();
        document.getElementById('login-overlay').style.display = 'flex';
        return;
    }
    
    // Hide Payment verify queue from non-Admins
    if (currentStaffRole !== 'Admin') {
        document.getElementById('tab-payments').style.display = 'none';
    }
    
    // Authorized! Load app components
    await loadDashboardStats();
    
    // Subscribe to Realtime notifications
    window.supabase
        .channel('mobile-notifications')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notifications_log' },
            (payload) => {
                const alert = payload.new;
                // Only alert if it's for this user or global (null)
                if (!alert.user_id || alert.user_id === userId) {
                    showToast(`New Alert: ${alert.title}`);
                }
                
                // Refresh data if relevant
                if (alert.event_type === 'payment_submitted' && document.getElementById('view-payments').classList.contains('active')) {
                    loadPayments();
                }
                if (document.getElementById('view-dashboard').classList.contains('active')) {
                    loadDashboardStats();
                }
                if (document.getElementById('view-alerts').classList.contains('active')) {
                    loadAlerts();
                }
            }
        )
        .subscribe();
        
    // Check push permissions, show banner if unprompted, otherwise register automatically
    if (!window.Capacitor && 'Notification' in window && Notification.permission === 'default') {
        const banner = document.getElementById('push-permission-banner');
        if(banner) banner.classList.remove('d-none');
    } else {
        await requestAndRegisterPush(userId);
    }
    
    // Process deep link from closed-state push notification
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const relatedId = urlParams.get('id');
    const notificationId = urlParams.get('nid');
    
    if (action) {
        executePushRoute({ event_type: action, related_id: relatedId, notification_id: notificationId });
    } else if (window.pendingPushRoute) {
        executePushRoute(window.pendingPushRoute);
        window.pendingPushRoute = null;
    }
}

// Global push routing executor
async function executePushRoute(pushData) {
    if (!currentStaffRole) {
        window.pendingPushRoute = pushData;
        return;
    }
    
    // Mark the underlying notification_log record as read
    if (pushData.notification_id) {
        try {
            await window.supabase.from('notifications_log').update({ read_status: true }).eq('id', pushData.notification_id);
            // Refresh alerts if it was open
            if (document.getElementById('view-alerts').classList.contains('active')) loadAlerts();
        } catch (e) { console.error("Error marking push alert read:", e); }
    }
    
    if (pushData.event_type === 'support_ticket_created') {
        switchTab('support');
    } else if (pushData.event_type === 'payment_submitted') {
        switchTab('payments');
    } else if (pushData.event_type === 'address_completed' && pushData.related_id) {
        switchTab('search');
        openShipmentDetail(pushData.related_id);
    }
}

// Global listener for background-state push notifications
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PUSH_ROUTE') {
            executePushRoute(event.data.data);
        }
    });
}

async function logout() {
    try {
        if (window.Capacitor) {
            // Capacitor doesn't expose a native unregister method, so we revoke via DB.
            // Ideally we'd store the token in localStorage, but since it's missing, we update all active tokens for this user.
            await window.supabase.from('admin_devices').update({ is_active: false }).eq('admin_id', (await window.supabase.auth.getUser()).data.user.id).eq('platform', 'android');
            try { window.Capacitor.Plugins.PushNotifications.removeAllListeners(); } catch (err) {}
        } else if ('serviceWorker' in navigator && 'PushManager' in window) {
            const sw = await navigator.serviceWorker.ready;
            const sub = await sw.pushManager.getSubscription();
            if (sub) {
                const subStr = JSON.stringify(sub);
                await window.supabase.from('admin_devices').update({ is_active: false }).eq('device_token', subStr);
                await sub.unsubscribe();
            }
        }
    } catch (e) {
        console.error('Error removing push subscription:', e);
    }
    
    await window.supabase.auth.signOut();
    window.location.reload();
}

// Helper: Play notification sound (Web Audio API)
function playNotificationSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Two beeps: 800Hz then 600Hz
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
        
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.15);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);
        oscillator.start(audioContext.currentTime + 0.15);
        oscillator.stop(audioContext.currentTime + 0.25);
    } catch (e) {
        console.log('Audio not supported:', e.message);
    }
}

// Helper: Vibrate device (Vibration API)
function vibrateDevice(pattern = [100, 50, 100]) {
    if (navigator.vibrate) {
        navigator.vibrate(pattern);
    }
}

// Enhanced Toast with swipe-to-dismiss
function showToast(message, enableSound = false) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast-custom';
    toast.textContent = message;
    
    // Touch tracking for swipe
    let touchStartX = 0;
    let touchEndX = 0;
    
    toast.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, false);
    
    toast.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        if (touchStartX - touchEndX > 50) { // Swiped left
            toast.style.animation = 'slideOutLeft 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        } else if (touchEndX - touchStartX > 50) { // Swiped right
            toast.style.animation = 'slideOutRight 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, false);
    
    // Click to dismiss
    toast.addEventListener('click', () => {
        toast.style.animation = 'fadeout 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    });
    
    container.appendChild(toast);
    
    // Optional: play sound and vibrate
    if (enableSound) {
        playNotificationSound();
        vibrateDevice([50, 30, 50]);
    }
    
    // Auto-dismiss after 2.7s
    const timeout = setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'fadeout 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 2700);
}


function switchTab(tabId) {
    // Strictly enforce Role-Based Access Control on navigation
    if (tabId === 'payments' && currentStaffRole !== 'Admin') {
        showToast("Access Denied: Not authorized for payments.");
        tabId = 'dashboard'; // Fallback
    }
    
    if (tabId === 'accounts' && currentStaffRole !== 'Admin') {
        showToast("Access Denied: Not authorized for accounts.");
        tabId = 'dashboard'; // Fallback
    }

    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    // Remove active from nav
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    // Show view
    document.getElementById(`view-${tabId}`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
    
    // Update header
    const titles = {
        'dashboard': 'Dashboard',
        'payments': 'Payments',
        'support': 'Support',
        'search': 'Shipments',
        'alerts': 'Notifications',
        'accounts': 'Payment Accounts'
    };
    document.getElementById('header-title').textContent = titles[tabId];
    
    // Lazy load data based on tab
    if (tabId === 'payments') loadPayments();
    else if (tabId === 'support') loadTickets();
    else if (tabId === 'alerts') loadAlerts();
    else if (tabId === 'accounts') loadMobileAccounts();
    else if (tabId === 'dashboard') loadDashboardStats();
}

async function loadDashboardStats() {
    const carousel = document.getElementById('m-urgent-carousel');
    const shipList = document.getElementById('m-active-shipments');
    
    // 1. Loading State
    carousel.innerHTML = `
        <div class="mobile-card flex-shrink-0 mb-0" style="width: 260px; scroll-snap-align: center; border-left: 6px solid var(--border-color);">
            <div class="d-flex align-items-center gap-2 mb-2 text-muted fw-bold">
                <div class="spinner-border spinner-border-sm"></div> Loading Tasks...
            </div>
        </div>
    `;
    shipList.innerHTML = '<div class="p-4 text-center text-muted"><div class="spinner-border spinner-border-sm text-ups-brown mb-2"></div><br>Loading Shipments...</div>';

    try {
        // Fetch Unread Notifications
        const { data: notifications, error: notifErr } = await window.supabase
            .from('notifications_log')
            .select('*')
            .eq('read_status', false)
            .order('created_at', { ascending: false })
            .limit(2);
            
        // Fetch pending payments count
        const { count: payCount } = await window.supabase
            .from('payments')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending_verification');
            
        // Fetch open tickets count
        const { count: ticketCount } = await window.supabase
            .from('support_tickets')
            .select('*', { count: 'exact', head: true })
            .neq('status', 'closed')
            .neq('status', 'resolved');
            
        carousel.innerHTML = '';
        
        // 1. Urgent Notifications
        if (notifications && notifications.length > 0) {
            notifications.forEach(n => {
                carousel.innerHTML += `
                    <div class="mobile-card flex-shrink-0 mb-0" style="width: 260px; scroll-snap-align: center; border-left: 6px solid var(--ups-blue);" onclick="switchTab('alerts')">
                        <div class="d-flex align-items-center gap-2 mb-2 text-ups-blue fw-bold">
                            <span class="material-symbols-rounded">notifications_active</span> New Alert
                        </div>
                        <div class="fw-bold text-truncate">${n.title}</div>
                        <div class="small text-muted text-truncate">${n.body || ''}</div>
                    </div>
                `;
            });
        }

        // 3. Payment Requests
        if (payCount > 0 && currentStaffRole === 'Admin') {
            carousel.innerHTML += `
                <div class="mobile-card flex-shrink-0 mb-0" style="width: 260px; scroll-snap-align: center; border-left: 6px solid #dc3545;" onclick="switchTab('payments')">
                    <div class="d-flex align-items-center gap-2 mb-2 text-danger fw-bold">
                        <span class="material-symbols-rounded">warning</span> Payment Action
                    </div>
                    <div class="fs-4 fw-bold">${payCount} Request${payCount>1?'s':''}</div>
                    <div class="small text-muted">Awaiting your approval</div>
                </div>
            `;
        }
        
        // 5. Customer-care requests
        if (ticketCount > 0) {
            carousel.innerHTML += `
                <div class="mobile-card flex-shrink-0 mb-0" style="width: 260px; scroll-snap-align: center; border-left: 6px solid var(--ups-yellow);" onclick="switchTab('support')">
                    <div class="d-flex align-items-center gap-2 mb-2 text-ups-brown fw-bold">
                        <span class="material-symbols-rounded">forum</span> Support Queue
                    </div>
                    <div class="fs-4 fw-bold">${ticketCount} Ticket${ticketCount>1?'s':''}</div>
                    <div class="small text-muted">Customer requests pending</div>
                </div>
            `;
        }
        
        // 2. Empty State (No pending actions)
        if (carousel.innerHTML === '') {
            carousel.innerHTML = `
                <div class="mobile-card flex-shrink-0 mb-0 text-center" style="width: 100%; border-left: 6px solid #198754;">
                    <div class="text-success mb-1"><span class="material-symbols-rounded" style="font-size:2rem">check_circle</span></div>
                    <div class="fw-bold">All caught up!</div>
                    <div class="small text-muted">No urgent tasks pending.</div>
                </div>
            `;
        }
        
        // 4. Active Shipments
        const { data: shipments, error: shipErr } = await window.supabase
            .from('shipments')
            .select('id, tracking_number, status, receivers(full_name, city), senders(city)')
            .neq('status', 'Delivered')
            .neq('status', 'Draft')
            .order('updated_at', { ascending: false })
            .limit(3);
            
        if (shipErr) throw shipErr;
            
        if (shipments && shipments.length > 0) {
            shipList.innerHTML = shipments.map(s => `
                <div class="shipment-card mb-3" style="border-left-color: var(--ups-yellow)" onclick="openShipmentDetail('${s.id}')">
                    <div class="shipment-card-header">
                        <span class="fw-bold fs-5">${s.tracking_number}</span>
                        <span class="badge bg-primary text-uppercase">${s.status}</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center mt-2">
                        <div class="small text-muted fw-bold">${s.senders?.city||'Unknown'} <span class="material-symbols-rounded align-middle text-ups-yellow" style="font-size:1rem">arrow_right_alt</span> ${s.receivers?.city||'Unknown'}</div>
                    </div>
                    <div class="small text-muted mt-2"><span class="material-symbols-rounded align-middle me-1" style="font-size:1rem">person</span>${s.receivers?.full_name||'Unknown'}</div>
                </div>
            `).join('');
        } else {
            shipList.innerHTML = '<div class="p-4 text-center text-muted border bg-white rounded">No active shipments right now.</div>';
        }

        // Quick Stats
        const { count: transitCount } = await window.supabase.from('shipments').select('*', { count: 'exact', head: true }).eq('status', 'In Transit');
        const { count: deliveredCount } = await window.supabase.from('shipments').select('*', { count: 'exact', head: true }).eq('status', 'Delivered');
        
        document.getElementById('stat-transit').textContent = transitCount || 0;
        document.getElementById('stat-delivered').textContent = deliveredCount || 0;
        
    } catch (err) {
        console.error("Dashboard Load Error:", err);
        carousel.innerHTML = `
            <div class="mobile-card flex-shrink-0 mb-0 w-100" style="border-left: 6px solid #dc3545;">
                <div class="text-danger fw-bold mb-1">Error Loading Dashboard</div>
                <div class="small text-muted">${err.message}</div>
            </div>
        `;
        shipList.innerHTML = `<div class="p-4 text-center text-danger border bg-white rounded">${err.message}</div>`;
    }
}

async function loadPayments() {
    const list = document.getElementById('payments-list');
    list.innerHTML = '<div class="p-5 text-center text-muted"><div class="spinner-border text-ups-brown mb-2"></div><br>Loading payments...</div>';
    
    try {
        // 1. Load regular payments (credit card, etc)
        const { data: payments, error: payError } = await window.supabase
            .from('payments')
            .select('*, shipments(tracking_number)')
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (payError) throw payError;
        
        // 2. Load bank account requests
        const { data: requests, error: reqError } = await window.supabase
            .from('bank_account_requests')
            .select('*, shipments(tracking_number, shipping_fee), receivers(full_name, email, phone)')
            .order('created_at', { ascending: false })
            .limit(50);

        // 3. Load PayPal / Cash App assignment requests
        const { data: methodRequests, error: methodReqError } = await window.supabase
            .from('payment_method_requests')
            .select('*, shipments(tracking_number, shipping_fee), receivers(full_name, email, phone)')
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (reqError) throw reqError;
        if (methodReqError) throw methodReqError;
        
        // Combine and sort
        const allItems = [];
        
        if (payments) {
            payments.forEach(p => {
                allItems.push({ ...p, type: 'payment' });
            });
        }
        
        if (requests) {
            requests.forEach(r => {
                allItems.push({ ...r, type: 'bank_request' });
            });
        }

        if (methodRequests) {
            methodRequests.forEach(r => {
                allItems.push({ ...r, type: 'method_request' });
            });
        }
        
        // Sort by created_at descending
        allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        if (allItems.length === 0) {
            list.innerHTML = '<div class="p-5 text-center text-muted"><span class="material-symbols-rounded fs-1 mb-2">check_circle</span><br>No payment requests found.</div>';
            return;
        }
        
        list.innerHTML = '';
        allItems.forEach(item => {
            const tracking = item.shipments?.tracking_number || 'Unknown';
            const date = new Date(item.created_at).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
            let statusBadge = '', statusColor = '';
            let amount = item.type === 'bank_request' || item.type === 'method_request'
                ? (item.shipments?.shipping_fee || 0)
                : (item.amount || 0);
            const methodLabel = item.type === 'method_request'
                ? (item.method_type === 'paypal' ? 'PayPal' : 'Cash App')
                : (item.type === 'bank_request' ? 'Bank Transfer' : (item.payment_method || 'N/A'));
            
            if (item.type === 'bank_request') {
                if (item.status === 'pending') { statusBadge = 'ASSIGN ACCOUNT'; statusColor = 'warning text-dark'; }
                else if (item.status === 'assigned') { statusBadge = 'ACCOUNT ASSIGNED'; statusColor = 'info'; }
                else if (item.status === 'sent') { statusBadge = 'WAITING FOR TRANSFER'; statusColor = 'primary'; }
            } else if (item.type === 'method_request') {
                if (item.status === 'pending') { statusBadge = 'ASSIGN DETAILS'; statusColor = 'warning text-dark'; }
                else if (item.status === 'assigned') { statusBadge = 'DETAILS ASSIGNED'; statusColor = 'info'; }
                else if (item.status === 'sent') { statusBadge = 'WAITING FOR PAYMENT'; statusColor = 'primary'; }
                else { statusBadge = item.status; statusColor = 'secondary'; }
            } else {
                if (item.status === 'verified') { statusBadge = 'APPROVED'; statusColor = 'success'; }
                else if (item.status === 'rejected') { statusBadge = 'REJECTED'; statusColor = 'danger'; }
                else if (item.status === 'pending_verification') { statusBadge = 'ACTION REQUIRED'; statusColor = 'warning text-dark'; }
                else { statusBadge = item.status; statusColor = 'secondary'; }
            }

            const card = document.createElement('div');
            card.className = `mobile-card mb-3 mx-3`;
            
            if (item.type === 'bank_request') {
                card.onclick = () => openBankRequest(item.id, tracking, amount, item.status, date, item.receivers);
            } else if (item.type === 'method_request') {
                card.onclick = () => openMethodRequest(item.id, tracking, amount, item.status, date, item.receivers, item.method_type, item.assigned_value);
            } else {
                card.onclick = () => openPayment(item.id, item.amount, tracking, item.receipt_url, item.payment_method, item.status, date);
            }
            
            card.innerHTML = `
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <span class="badge bg-${statusColor} px-2 py-1">${statusBadge}</span>
                    <span class="small text-muted">${date}</span>
                </div>
                <h4 class="fw-bold mb-1">$${Number(amount).toFixed(2)}</h4>
                <div class="text-muted small mb-2">${tracking} &bull; ${methodLabel}</div>
                <div class="d-flex justify-content-end text-ups-brown fw-bold small align-items-center">
                    ${(item.type === 'bank_request' || item.type === 'method_request') && item.status === 'pending' ? '<span class="material-symbols-rounded me-1" style="color: #dc3545;">warning</span>' : ''}
                    ${(item.type === 'bank_request' || item.type === 'method_request') ? 'Details' : 'Review'} <span class="material-symbols-rounded ms-1" style="font-size:1.2rem">chevron_right</span>
                </div>
            `;
            list.appendChild(card);
        });
    } catch (err) {
        list.innerHTML = `
            <div class="p-5 text-center text-danger">
                <span class="material-symbols-rounded fs-1 mb-2">error</span><br>
                <strong>Error loading payments</strong><br>${err.message}
            </div>
        `;
    }
}

function openMethodRequest(id, tracking, amount, status, date, receiver, methodType, assignedValue) {
    const body = document.getElementById('m-pay-dynamic-body');
    const methodLabel = methodType === 'paypal' ? 'PayPal' : 'Cash App';
    
    let statusBadge = '', statusColor = '';
    if (status === 'pending') { statusBadge = 'ASSIGN DETAILS'; statusColor = 'warning text-dark'; }
    else if (status === 'assigned') { statusBadge = 'DETAILS ASSIGNED'; statusColor = 'info'; }
    else if (status === 'sent') { statusBadge = 'WAITING FOR PAYMENT'; statusColor = 'primary'; }
    else { statusBadge = status || 'Unknown'; statusColor = 'secondary'; }

    let receiverInfo = receiver ? `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="text-muted small fw-bold">CUSTOMER</div>
            <div class="fw-bold">${receiver.full_name}</div>
        </div>
    ` : '';

    let assignedHtml = assignedValue
        ? `
            <div class="p-3 border rounded mb-3 bg-light">
                <div class="small text-muted fw-bold text-uppercase mb-2">Assigned ${methodLabel} Details</div>
                <div class="fw-bold text-break">${assignedValue}</div>
            </div>
        `
        : `
            <div class="p-4 text-center text-muted border bg-light rounded mb-3">
                <span class="material-symbols-rounded fs-1 mb-2">pending</span><br>
                <div class="fw-bold">${methodLabel} Details Pending</div>
                <div class="small">Waiting for admin assignment.</div>
            </div>
        `;

    let actionHtml = '';
    if (status === 'pending') {
        actionHtml = `
            <div class="mt-auto bg-white p-4 border-top">
                <h6 class="text-muted fw-bold small mb-3">REQUIRED ACTION</h6>
                <button class="btn btn-ups w-100 py-3 fw-bold shadow-sm" style="border-radius:24px; font-size:1rem;" onclick="openAssignPaymentMethodModal('${id}', '${methodType}')">
                    <span class="material-symbols-rounded align-middle me-2">payments</span>Assign ${methodLabel} Details
                </button>
            </div>
        `;
    } else {
        actionHtml = `
            <div class="mt-auto bg-white p-4 border-top text-center text-muted">
                <span class="material-symbols-rounded fs-1 mb-2">check_circle</span><br>
                <div class="fw-bold">Assignment Status</div>
                <div class="small">The receiver has been notified of the ${methodLabel} details.</div>
            </div>
        `;
    }
    
    body.innerHTML = `
        <div class="p-4 bg-white border-bottom text-center">
            <span class="badge bg-${statusColor} px-3 py-2 fs-6 rounded-pill mb-3">${statusBadge}</span>
            <div class="text-muted small fw-bold text-uppercase mb-1">Shipment</div>
            <h4 class="fw-bold text-ups-brown mb-0" style="word-break: break-all;">${tracking}</h4>
        </div>
        
        <div class="p-4 bg-white mb-2 border-bottom">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="text-muted small fw-bold">AMOUNT</div>
                <div class="fs-2 fw-bold text-dark">$${Number(amount).toFixed(2)}</div>
            </div>
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="text-muted small fw-bold">METHOD</div>
                <div class="fw-bold">${methodLabel}</div>
            </div>
            ${receiverInfo}
            <div class="d-flex justify-content-between align-items-center">
                <div class="text-muted small fw-bold">REQUESTED</div>
                <div class="fw-bold small">${date}</div>
            </div>
        </div>
        
        <div class="p-4 bg-white flex-grow-1">
            ${assignedHtml}
        </div>

        ${actionHtml}
    `;
    
    const modal = new bootstrap.Modal(document.getElementById('paymentModal'));
    modal.show();
}

function openBankRequest(id, tracking, amount, status, date, receiver) {
    const body = document.getElementById('m-pay-dynamic-body');
    
    let statusBadge = '', statusColor = '';
    if (status === 'pending') { statusBadge = 'ASSIGN ACCOUNT'; statusColor = 'warning text-dark'; }
    else if (status === 'assigned') { statusBadge = 'ACCOUNT ASSIGNED'; statusColor = 'info'; }
    else if (status === 'sent') { statusBadge = 'WAITING FOR TRANSFER'; statusColor = 'primary'; }
    
    let actionHtml = '';
    if (status === 'pending') {
        actionHtml = `
            <div class="mt-auto bg-white p-4 border-top">
                <h6 class="text-muted fw-bold small mb-3">REQUIRED ACTION</h6>
                <button class="btn btn-ups w-100 py-3 fw-bold shadow-sm" style="border-radius:24px; font-size:1rem;" onclick="openAssignAccountModal('${id}')">
                    <span class="material-symbols-rounded align-middle me-2">account_balance</span>Assign Bank Account
                </button>
            </div>
        `;
    } else {
        actionHtml = `
            <div class="mt-auto bg-white p-4 border-top text-center text-muted">
                <span class="material-symbols-rounded fs-1 mb-2">check_circle</span><br>
                <div class="fw-bold">Account Status</div>
                <div class="small">The receiver has been notified of the bank details.</div>
            </div>
        `;
    }
    
    let receiverInfo = receiver ? `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="text-muted small fw-bold">CUSTOMER</div>
            <div class="fw-bold">${receiver.full_name}</div>
        </div>
    ` : '';
    
    body.innerHTML = `
        <div class="p-4 bg-white border-bottom text-center">
            <span class="badge bg-${statusColor} px-3 py-2 fs-6 rounded-pill mb-3">${statusBadge}</span>
            <div class="text-muted small fw-bold text-uppercase mb-1">Shipment</div>
            <h4 class="fw-bold text-ups-brown mb-0" style="word-break: break-all;">${tracking}</h4>
        </div>
        
        <div class="p-4 bg-white mb-2 border-bottom">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="text-muted small fw-bold">AMOUNT</div>
                <div class="fs-2 fw-bold text-dark">$${Number(amount).toFixed(2)}</div>
            </div>
            ${receiverInfo}
            <div class="d-flex justify-content-between align-items-center">
                <div class="text-muted small fw-bold">REQUESTED</div>
                <div class="fw-bold small">${date}</div>
            </div>
        </div>
        
        <div class="p-4 bg-white flex-grow-1">
            <div class="p-4 text-center text-muted border bg-light rounded mb-3">
                <span class="material-symbols-rounded fs-1 mb-2">info</span><br>
                <div class="fw-bold">Bank Transfer Payment</div>
                <div class="small">Receiver is waiting for your bank account details.</div>
            </div>
        </div>
        
        ${actionHtml}
    `;
    
    const modal = new bootstrap.Modal(document.getElementById('paymentModal'));
    modal.show();
}

async function openAssignAccountModal(requestId) {
    document.getElementById('assign-request-id').value = requestId;
    
    // Clear form fields
    document.getElementById('assign-bank-name').value = '';
    document.getElementById('assign-account-name').value = '';
    document.getElementById('assign-account-number').value = '';
    document.getElementById('assign-account-type').value = '';
    
    new bootstrap.Modal(document.getElementById('assignAccountModal')).show();
}

async function openAssignPaymentMethodModal(requestId, methodType) {
    document.getElementById('assign-payment-method-request-id').value = requestId;
    document.getElementById('assign-payment-method-type').value = methodType;
    document.getElementById('assign-payment-method-value').value = '';

    const label = document.getElementById('assign-payment-method-label');
    const input = document.getElementById('assign-payment-method-value');
    if (methodType === 'paypal') {
        label.textContent = 'PayPal Email / Username';
        input.placeholder = 'e.g. paypal.me/username or username@example.com';
    } else {
        label.textContent = 'Cash App Cashtag / Username';
        input.placeholder = 'e.g. $cashappname or @username';
    }

    new bootstrap.Modal(document.getElementById('assignPaymentMethodModal')).show();
}

async function confirmAssignAccount() {
    const requestId = document.getElementById('assign-request-id').value;
    const bankName = document.getElementById('assign-bank-name').value.trim();
    const accountName = document.getElementById('assign-account-name').value.trim();
    const accountNumber = document.getElementById('assign-account-number').value.trim();
    const accountType = document.getElementById('assign-account-type').value;
    
    if (!requestId) {
        showToast('Request ID missing');
        return;
    }
    
    if (!bankName || !accountName || !accountNumber || !accountType) {
        showToast('Please fill all fields');
        return;
    }
    
    try {
        // Create account with manual input details
        const { data: newAccount, error: createError } = await window.supabase
            .from('bank_accounts')
            .insert([{
                bank_name: bankName,
                account_name: accountName,
                account_number: accountNumber,
                account_type: accountType,
                is_active: false,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();
        
        if (createError) throw createError;
        const accountId = newAccount.id;
        
        // Get payment details for notification
        const { data: paymentRequest } = await window.supabase
            .from('bank_account_requests')
            .select('shipment_id, amount')
            .eq('id', requestId)
            .single();
        
        // Assign the account to the request
        const { error: assignError } = await window.supabase
            .from('bank_account_requests')
            .update({
                assigned_bank_account_id: accountId,
                status: 'assigned',
                assigned_at: new Date().toISOString()
            })
            .eq('id', requestId);
        
        if (assignError) throw assignError;
        
        // Send push notification to receiver about account assignment
        const shipmentId = paymentRequest?.shipment_id;
        const amount = paymentRequest?.amount || '0.00';
        
        if (shipmentId) {
            await window.supabase.from('notifications_log').insert([{
                title: 'Bank Account Details Assigned',
                body: `Your bank account details have been assigned for this payment. Amount: $${parseFloat(amount).toFixed(2)}.`,
                event_type: 'bank_account_assigned',
                related_id: shipmentId
            }]);
        }
        
        // Success toast WITH sound and vibration
        showToast('✓ Bank account assigned! Receiver notified.', true);
        bootstrap.Modal.getInstance(document.getElementById('assignAccountModal')).hide();
        bootstrap.Modal.getInstance(document.getElementById('paymentModal')).hide();
        await loadPayments();
    } catch (err) {
        showToast('Error assigning account: ' + err.message);
    }
}

async function confirmAssignPaymentMethod() {
    const requestId = document.getElementById('assign-payment-method-request-id').value;
    const methodType = document.getElementById('assign-payment-method-type').value;
    const assignedValue = document.getElementById('assign-payment-method-value').value.trim();

    if (!requestId || !methodType) {
        showToast('Request data is missing.');
        return;
    }

    if (!assignedValue) {
        showToast(`Please enter the ${methodType === 'paypal' ? 'PayPal' : 'Cash App'} details.`);
        return;
    }

    try {
        // Create a structured account record and assign it to the request for parity with bank flow
        const userRes = await window.supabase.auth.getUser();
        const adminId = userRes?.data?.user?.id || null;

        const { data: newAcct, error: acctErr } = await window.supabase
            .from('payment_method_accounts')
            .insert([{
                method_type: methodType,
                label: methodType === 'paypal' ? 'PayPal' : 'Cash App',
                account_value: assignedValue,
                is_active: false,
                created_by: adminId,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (acctErr || !newAcct) throw (acctErr || new Error('Failed to create payment method account'));

        // Assign the account id to the request
        const { error } = await window.supabase
            .from('payment_method_requests')
            .update({
                assigned_payment_method_account_id: newAcct.id,
                status: 'assigned',
                assigned_at: new Date().toISOString(),
                assigned_by: adminId
            })
            .eq('id', requestId)
            .eq('method_type', methodType);

        if (error) throw error;

        await window.supabase.from('notifications_log').insert([{
            title: `${methodType === 'paypal' ? 'PayPal' : 'Cash App'} Details Assigned`,
            body: `Your ${methodType === 'paypal' ? 'PayPal' : 'Cash App'} payment details have been assigned for this shipment.`,
            event_type: 'payment_method_assigned',
            related_id: requestId
        }]);

        showToast(`✓ ${methodType === 'paypal' ? 'PayPal' : 'Cash App'} details assigned! Receiver notified.`, true);
        bootstrap.Modal.getInstance(document.getElementById('assignPaymentMethodModal')).hide();
        bootstrap.Modal.getInstance(document.getElementById('paymentModal')).hide();
        await loadPayments();
    } catch (err) {
        showToast('Error assigning payment details: ' + err.message);
    }
}

function openPayment(id, amount, tracking, receiptUrl, method, status, date) {
    activePaymentId = id;
    
    let statusBadge = '';
    let statusColor = '';
    if (status === 'verified') { statusBadge = 'APPROVED'; statusColor = 'success'; }
    else if (status === 'rejected') { statusBadge = 'REJECTED'; statusColor = 'danger'; }
    else if (status === 'pending_verification') { statusBadge = 'ACTION REQUIRED'; statusColor = 'warning text-dark'; }
    else { statusBadge = status; statusColor = 'secondary'; }

    let receiptHtml = receiptUrl 
        ? `<a href="${receiptUrl}" target="_blank" class="btn btn-outline-ups w-100 mb-4 py-3 fw-bold" style="border-radius: 24px;"><span class="material-symbols-rounded align-middle me-2">receipt_long</span>View Receipt Image</a>`
        : `<div class="p-4 text-center text-muted border bg-light mb-4 rounded"><span class="material-symbols-rounded fs-1 mb-2">image_not_supported</span><br>No Receipt Attached</div>`;

    let actionsHtml = '';
    if (status === 'pending_verification' && currentStaffRole === 'Admin') {
        actionsHtml = `
            <div class="mt-auto bg-white p-4 border-top">
                <h6 class="text-muted fw-bold small mb-3">REQUIRED ACTION</h6>
                <button class="btn btn-success w-100 py-3 mb-3 fw-bold shadow-sm" style="border-radius:24px; font-size:1.1rem;" onclick="if(confirm('Are you sure you want to APPROVE this payment?')) approvePayment()">
                    <span class="material-symbols-rounded align-middle me-2">check_circle</span>Approve Payment
                </button>
                <button class="btn btn-outline-danger w-100 py-3 fw-bold" style="border-radius:24px;" onclick="if(confirm('Are you sure you want to REJECT this payment? This cannot be undone.')) rejectPayment()">
                    <span class="material-symbols-rounded align-middle me-2">cancel</span>Reject Payment
                </button>
            </div>
        `;
    } else {
        actionsHtml = `
            <div class="mt-auto bg-white p-4 border-top text-center text-muted">
                <span class="material-symbols-rounded fs-1 mb-2">lock</span><br>
                <div class="fw-bold">No Actions Available</div>
                <div class="small">This payment is already processed.</div>
            </div>
        `;
    }

    const body = document.getElementById('m-pay-dynamic-body');
    body.innerHTML = `
        <div class="p-4 bg-white border-bottom text-center">
            <span class="badge bg-${statusColor} px-3 py-2 fs-6 rounded-pill mb-3">${statusBadge}</span>
            <div class="text-muted small fw-bold text-uppercase mb-1">Shipment</div>
            <h4 class="fw-bold text-ups-brown mb-0" style="word-break: break-all;">${tracking}</h4>
        </div>
        
        <div class="p-4 bg-white mb-2 border-bottom">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="text-muted small fw-bold">AMOUNT</div>
                <div class="fs-2 fw-bold text-dark">$${Number(amount).toFixed(2)}</div>
            </div>
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="text-muted small fw-bold">METHOD</div>
                <div class="fw-bold">${method || 'N/A'}</div>
            </div>
            <div class="d-flex justify-content-between align-items-center">
                <div class="text-muted small fw-bold">SUBMITTED</div>
                <div class="fw-bold small">${date}</div>
            </div>
        </div>
        
        <div class="p-4 bg-white flex-grow-1">
            ${receiptHtml}
        </div>
        
        ${actionsHtml}
    `;
    
    const modal = new bootstrap.Modal(document.getElementById('paymentModal'));
    modal.show();
}

async function approvePayment() {
    if (!activePaymentId) return;
    try {
        // Find shipment_id for this payment
        const { data: pay } = await window.supabase.from('payments').select('shipment_id').eq('id', activePaymentId).single();
        if (!pay) throw new Error("Payment not found");
        
        // Update both tables
        await window.supabase.from('payments').update({ status: 'verified' }).eq('id', activePaymentId);
        await window.supabase.from('shipments').update({ payment_status: 'paid' }).eq('id', pay.shipment_id);
        
        await window.supabase.from('notifications_log').insert([{
            title: 'Payment Verified',
            body: 'Payment verified',
            event_type: 'payment_verified',
            related_id: pay.shipment_id
        }]);
        
        showToast("Payment Approved!");
        bootstrap.Modal.getInstance(document.getElementById('paymentModal')).hide();
        loadPayments();
        loadDashboardStats();
    } catch (err) {
        alert(err.message);
    }
}

async function rejectPayment() {
    if (!activePaymentId) return;
    try {
        const { data: pay } = await window.supabase.from('payments').select('shipment_id').eq('id', activePaymentId).single();
        if (!pay) throw new Error("Payment not found");
        
        await window.supabase.from('payments').update({ status: 'rejected' }).eq('id', activePaymentId);
        await window.supabase.from('shipments').update({ payment_status: 'unpaid' }).eq('id', pay.shipment_id);
        
        await window.supabase.from('notifications_log').insert([{
            title: 'Payment Rejected',
            body: 'Payment rejected',
            event_type: 'payment_rejected',
            related_id: pay.shipment_id
        }]);
        
        showToast("Payment Rejected!");
        bootstrap.Modal.getInstance(document.getElementById('paymentModal')).hide();
        loadPayments();
        loadDashboardStats();
    } catch (err) {
        alert(err.message);
    }
}

async function loadTickets() {
    const list = document.getElementById('tickets-list');
    list.innerHTML = '<div class="p-5 text-center text-muted"><div class="spinner-border text-ups-brown mb-2"></div><br>Loading tickets...</div>';
    
    try {
        const { data, error } = await window.supabase
            .from('support_tickets')
            .select('*, shipments(tracking_number)')
            .neq('status', 'closed')
            .order('updated_at', { ascending: false });
            
        if (error) throw error;
        
        if (data.length === 0) {
            list.innerHTML = '<div class="p-5 text-center text-muted"><span class="material-symbols-rounded fs-1 mb-2">task_alt</span><br>Inbox is clear!</div>';
            return;
        }
        
        const unread = data.filter(t => t.status === 'open');
        const assigned = data.filter(t => t.status !== 'open');
        
        list.innerHTML = '';
        
        if (unread.length > 0) {
            list.innerHTML += `<div class="px-3 pt-3 pb-2 text-muted fw-bold small text-uppercase d-flex align-items-center"><span class="badge bg-danger me-2">${unread.length}</span> Unread Requests</div>`;
            unread.forEach(t => list.appendChild(createTicketCard(t, true)));
        }
        
        if (assigned.length > 0) {
            list.innerHTML += `<div class="px-3 pt-4 pb-2 text-muted fw-bold small text-uppercase d-flex align-items-center"><span class="badge bg-secondary me-2">${assigned.length}</span> Active Conversations</div>`;
            assigned.forEach(t => list.appendChild(createTicketCard(t, false)));
        }
        
    } catch (err) {
        list.innerHTML = `<div class="p-4 text-danger text-center">${err.message}</div>`;
    }
}

function createTicketCard(t, isUnread) {
    const div = document.createElement('div');
    div.className = `mobile-card mx-3 mb-2 px-3 py-3`;
    
    const time = new Date(t.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    div.onclick = () => openMobileChat(t);
    div.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="fw-bold fs-6 text-dark text-truncate pe-2 ${isUnread ? '' : 'text-muted'}">${t.sender_name}</div>
            <div class="small ${isUnread ? 'text-primary fw-bold' : 'text-muted'}">${time}</div>
        </div>
        <div class="small fw-bold text-dark text-truncate mb-1">${t.subject}</div>
        <div class="small text-muted d-flex justify-content-between align-items-center">
            <span>${t.shipments?.tracking_number || 'No Tracking Attached'}</span>
            <span class="material-symbols-rounded text-ups-brown" style="font-size:1.2rem">chevron_right</span>
        </div>
    `;
    return div;
}

let activeMobileTicketId = null;

function closeChat() {
    document.getElementById('view-chat').style.display = 'none';
}

async function openMobileChat(t) {
    activeMobileTicketId = t.id;
    document.getElementById('view-chat').style.display = 'flex';
    document.getElementById('view-chat').classList.add('active');
    document.getElementById('m-chat-subject').textContent = t.subject;
    document.getElementById('m-chat-customer').textContent = `${t.sender_name} | ${t.shipments?.tracking_number || 'N/A'}`;
    
    // Set status dropdown
    const statusSelect = document.getElementById('m-chat-status');
    if (statusSelect) {
        statusSelect.value = t.status;
    }
    
    const infoBtn = document.getElementById('m-chat-info-btn');
    if (t.shipment_id) {
        infoBtn.style.display = 'block';
        infoBtn.onclick = () => openShipmentDetail(t.shipment_id);
    } else {
        infoBtn.style.display = 'none';
    }
    
    await loadMobileChatMessages();
}

async function updateMobileTicketStatus(newStatus) {
    if (!activeMobileTicketId) return;
    try {
        const { error } = await window.supabase
            .from('support_tickets')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', activeMobileTicketId);
            
        if (error) throw error;
        showToast("Ticket status updated");
        // Reload list in background
        loadTickets();
        if (newStatus === 'closed' || newStatus === 'resolved') {
            closeChat();
        }
    } catch (err) {
        alert("Failed to update status: " + err.message);
    }
}

async function loadMobileChatMessages() {
    if (!activeMobileTicketId) return;
    const container = document.getElementById('m-chat-messages');
    container.innerHTML = '<div class="text-center text-muted">Loading...</div>';
    
    try {
        const { data, error } = await window.supabase
            .from('ticket_replies')
            .select('*')
            .eq('ticket_id', activeMobileTicketId)
            .order('created_at', { ascending: true });
            
        if (error) throw error;
        
        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<div class="text-center text-muted mt-3">No messages yet.</div>';
            return;
        }
        
        data.forEach(r => {
            const isInternal = r.sender_type === 'internal';
            const isAdmin = r.sender_type === 'admin' || isInternal;
            const bgClass = isInternal ? 'bg-warning bg-opacity-25 border border-warning' : (isAdmin ? 'bg-white border shadow-sm' : 'bg-ups-brown text-white shadow-sm');
            const alignClass = isAdmin ? 'ms-auto' : 'me-auto';
            const sender = isInternal ? 'Internal Note' : (isAdmin ? 'You (Agent)' : 'Customer');
            const textColor = isInternal ? 'text-danger' : (isAdmin ? 'text-ups-brown' : 'text-ups-yellow');
            const msgColor = isAdmin ? 'text-dark' : 'text-white';
            
            // Escape HTML and parse ATTACHMENT
            let msgContent = r.message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const attachmentRegex = /\[ATTACHMENT\]\((.*?)\)/g;
            msgContent = msgContent.replace(attachmentRegex, '<br><a href="$1" target="_blank"><img src="$1" style="max-width: 100%; max-height: 200px; margin-top: 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); object-fit: contain;" alt="Attachment"></a>');

            const div = document.createElement('div');
            div.className = `mb-3 p-3 rounded-4 ${alignClass} ${bgClass}`;
            div.style.maxWidth = '85%';
            div.innerHTML = `
                <div class="small fw-bold mb-1 ${textColor}">${sender}</div>
                <div style="font-size:0.95rem; white-space:pre-wrap;" class="${msgColor}">${msgContent}</div>
            `;
            container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
        
    } catch (err) {
        container.innerHTML = `<div class="text-danger p-3">Error: ${err.message}</div>`;
    }
}

async function sendMobileReply() {
    if (!activeMobileTicketId) return;
    
    const input = document.getElementById('m-chat-input');
    const imageInput = document.getElementById('m-chat-image-input');
    const type = document.getElementById('m-chat-type').value;
    const btn = document.getElementById('m-chat-send-btn');
    
    let msg = input.value.trim();
    if (!msg && (!imageInput || imageInput.files.length === 0)) return;
    
    btn.disabled = true;
    const savedText = input.value;
    
    try {
        if (imageInput && imageInput.files.length > 0) {
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
            const file = imageInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `chat_${Date.now()}.${fileExt}`;

            const { error: uploadError } = await window.supabase
                .storage.from('receipts').upload(fileName, file, { cacheControl: '3600', upsert: false });
            if (uploadError) throw uploadError;

            const { data: publicUrlData } = window.supabase.storage.from('receipts').getPublicUrl(fileName);
            msg += (msg ? '\n\n' : '') + `[ATTACHMENT](${publicUrlData.publicUrl})`;
        }

        const { error } = await window.supabase
            .from('ticket_replies')
            .insert([{ ticket_id: activeMobileTicketId, sender_type: type, message: msg }]);
            
        if (error) throw error;
        
        input.value = '';
        clearMobileChatImage();
        await loadMobileChatMessages();
        
    } catch (err) {
        input.value = savedText;
        showToast("Error: " + err.message);
    } finally {
        btn.innerHTML = '<span class="material-symbols-rounded" style="font-size: 20px;">send</span>';
        btn.disabled = false;
        input.focus();
    }
}

function previewMobileChatImage(input) {
    const preview = document.getElementById('m-chat-image-preview');
    const img = document.getElementById('m-chat-preview-img');
    const name = document.getElementById('m-chat-preview-name');
    if (input.files && input.files[0]) {
        img.src = URL.createObjectURL(input.files[0]);
        name.textContent = input.files[0].name;
        preview.classList.remove('d-none');
    }
}

function clearMobileChatImage() {
    const imageInput = document.getElementById('m-chat-image-input');
    const preview = document.getElementById('m-chat-image-preview');
    if (imageInput) imageInput.value = '';
    if (preview) preview.classList.add('d-none');
}

async function loadAlerts() {
    const list = document.getElementById('alerts-list');
    list.innerHTML = '<div class="p-5 text-center text-muted"><div class="spinner-border text-ups-brown mb-2"></div><br>Loading notifications...</div>';
    
    try {
        const { data, error } = await window.supabase
            .from('notifications_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (error) throw error;
        
        if (data.length === 0) {
            list.innerHTML = '<div class="p-5 text-center text-muted"><span class="material-symbols-rounded fs-1 mb-2">notifications_off</span><br>No notifications yet.</div>';
            return;
        }
        
        const now = new Date();
        const unread = data.filter(n => !n.read_status);
        const read = data.filter(n => n.read_status);
        
        const today = read.filter(n => new Date(n.created_at).toDateString() === now.toDateString());
        const earlier = read.filter(n => new Date(n.created_at).toDateString() !== now.toDateString());
        
        list.innerHTML = '';
        
        if (unread.length > 0) {
            list.innerHTML += `<div class="px-3 pt-3 pb-2 text-muted fw-bold small text-uppercase"><span class="badge bg-danger me-2">${unread.length}</span> Unread</div>`;
            unread.forEach(n => list.appendChild(createNotificationCard(n)));
        }
        if (today.length > 0) {
            list.innerHTML += `<div class="px-3 pt-4 pb-2 text-muted fw-bold small text-uppercase">Today</div>`;
            today.forEach(n => list.appendChild(createNotificationCard(n)));
        }
        if (earlier.length > 0) {
            list.innerHTML += `<div class="px-3 pt-4 pb-2 text-muted fw-bold small text-uppercase">Earlier</div>`;
            earlier.forEach(n => list.appendChild(createNotificationCard(n)));
        }
        
    } catch (err) {
        list.innerHTML = `<div class="p-5 text-center text-danger"><span class="material-symbols-rounded fs-1 mb-2">error</span><br>Error loading notifications.</div>`;
    }
}

function createNotificationCard(n) {
    const card = document.createElement('div');
    card.className = `list-item px-3 py-3 mx-3 mb-2 d-flex flex-column`;
    card.style.background = n.read_status ? 'var(--bg-light)' : 'white';
    card.style.borderBottom = '1px solid var(--border-color)';
    card.style.borderRadius = '8px';
    
    const time = new Date(n.created_at).toLocaleString([], {month:'short', day:'numeric', hour: '2-digit', minute:'2-digit'});
    
    // Determine icon and route
    let icon = 'notifications';
    let iconColor = 'text-muted';
    if (n.event_type === 'payment_submitted') { icon = 'payments'; iconColor = 'text-success'; }
    else if (n.event_type === 'support_ticket') { icon = 'forum'; iconColor = 'text-warning'; }
    
    card.onclick = async () => {
        // Mark read
        if (!n.read_status) {
            await window.supabase.from('notifications_log').update({ read_status: true }).eq('id', n.id);
            n.read_status = true;
            card.style.background = 'var(--bg-light)';
            
            // Deduct unread counter logic could go here, or just let loadDashboardStats handle it naturally
        }
        
        // Navigate
        if (n.event_type === 'payment_submitted') {
            switchTab('payments');
        } else if (n.event_type === 'support_ticket') {
            switchTab('support');
        } else if (n.related_id) {
            openShipmentDetail(n.related_id);
        }
    };
    
    card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start mb-1">
            <div class="d-flex gap-2 align-items-center">
                <span class="material-symbols-rounded ${iconColor}" style="font-size:1.2rem">${icon}</span>
                <strong class="text-dark ${n.read_status ? 'fw-normal' : 'fw-bold'}">${n.title}</strong>
            </div>
            <span class="small ${n.read_status ? 'text-muted' : 'text-primary fw-bold'}" style="font-size:0.7rem">${time}</span>
        </div>
        <div class="small ${n.read_status ? 'text-muted' : 'text-dark'} ms-4 ps-1">${n.body || n.message || ''}</div>
    `;
    return card;
}

async function searchShipment() {
    const query = document.getElementById('mobile-search-input').value.trim();
    if (!query) return;
    const res = document.getElementById('search-results');
    res.innerHTML = '<div class="text-center mt-4"><div class="spinner-border text-ups-brown spinner-border-sm"></div></div>';
    
    try {
        const { data, error } = await window.supabase
            .from('shipments')
            .select('id')
            .eq('tracking_number', query);
            
        if (error) throw error;
        
        if (data.length === 0) {
            res.innerHTML = '<div class="alert alert-warning mt-3">No shipment found.</div>';
            return;
        }
        
        res.innerHTML = ''; // clear search spinner
        await openShipmentDetail(data[0].id);
        
    } catch (err) {
        res.innerHTML = `<div class="alert alert-danger mt-3">${err.message}</div>`;
    }
}

function closeShipmentDetail() {
    document.getElementById('view-shipment-detail').style.display = 'none';
    document.getElementById('view-shipment-detail').classList.remove('active');
}

async function openShipmentDetail(shipmentId) {
    const v = document.getElementById('view-shipment-detail');
    const content = document.getElementById('m-detail-content');
    
    v.style.display = 'flex';
    v.classList.add('active'); // puts it above other views if needed
    content.innerHTML = '<div class="p-5 text-center"><div class="spinner-border text-ups-brown"></div></div>';
    
    try {
        const { data: s, error } = await window.supabase
            .from('shipments')
            .select(`
                *,
                senders(full_name, phone, address, city, country),
                receivers(full_name, phone, address, city, postal_code, country),
                packages(description, weight),
                tracking_events(*)
            `)
            .eq('id', shipmentId)
            .single();
            
        if (error) throw error;
        
        document.getElementById('m-detail-tracking').textContent = s.tracking_number;
        
        let sBadge = 'bg-secondary';
        if (s.status === 'Delivered') sBadge = 'bg-success';
        else if (s.status === 'In Transit' || s.status === 'Out For Delivery') sBadge = 'bg-primary';
        else if (s.status === 'Picked Up') sBadge = 'bg-warning text-dark';
        
        s.tracking_events.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        let timelineHtml = s.tracking_events.map(ev => `
            <div class="mb-3 border-start border-3 ps-3 ms-2" style="border-color: var(--ups-yellow) !important;">
                <div class="fw-bold fs-6">${ev.status}</div>
                <div class="small text-muted">${ev.location} &bull; ${new Date(ev.created_at).toLocaleString()}</div>
            </div>
        `).join('');
        if (!timelineHtml) timelineHtml = '<div class="text-muted small">No tracking events logged.</div>';

        // Additional queries based on role
        let paymentsHtml = '';
        if (currentStaffRole === 'Admin') {
            const { data: payments } = await window.supabase.from('payments').select('*').eq('shipment_id', shipmentId);
            if (payments && payments.length > 0) {
                const p = payments[0];
                paymentsHtml = `
                    <div class="bg-white mt-2 border-top border-bottom">
                        <div class="p-3 fw-bold text-ups-brown d-flex justify-content-between align-items-center" onclick="this.nextElementSibling.classList.toggle('d-none')">
                            <span><span class="material-symbols-rounded align-middle me-2">payments</span>Payment Information</span>
                            <span class="material-symbols-rounded">expand_more</span>
                        </div>
                        <div class="p-3 pt-0 border-top d-none small">
                            <div class="mb-1"><strong>Status:</strong> <span class="badge ${p.status==='verified'?'bg-success':(p.status==='pending_verification'?'bg-warning text-dark':'bg-danger')}">${p.status}</span></div>
                            <div class="mb-1"><strong>Amount:</strong> $${p.amount}</div>
                            <div class="mb-1"><strong>Method:</strong> ${p.payment_method}</div>
                            ${p.receipt_url ? `<a href="${p.receipt_url}" target="_blank" class="btn btn-sm btn-outline-ups mt-2">View Receipt</a>` : ''}
                        </div>
                    </div>
                `;
            }
        }

        let supportHtml = '';
        if (currentStaffRole === 'Admin' || currentStaffRole === 'Customer Care Agent') {
            const { data: tickets } = await window.supabase.from('support_tickets').select('*').eq('shipment_id', shipmentId);
            if (tickets && tickets.length > 0) {
                const activeTickets = tickets.filter(t => t.status !== 'closed' && t.status !== 'resolved').length;
                supportHtml = `
                    <div class="bg-white mt-2 border-top border-bottom">
                        <div class="p-3 fw-bold text-ups-brown d-flex justify-content-between align-items-center" onclick="this.nextElementSibling.classList.toggle('d-none')">
                            <span><span class="material-symbols-rounded align-middle me-2">forum</span>Support Context ${activeTickets > 0 ? `<span class="badge bg-danger rounded-pill ms-2">${activeTickets} Active</span>` : ''}</span>
                            <span class="material-symbols-rounded">expand_more</span>
                        </div>
                        <div class="p-3 pt-0 border-top d-none small">
                            ${tickets.map(t => `<div class="mb-2 pb-2 border-bottom"><strong>${t.subject}</strong><br><span class="text-muted">Status: ${t.status}</span></div>`).join('')}
                        </div>
                    </div>
                `;
            }
        }

        content.innerHTML = `
            <!-- 1 & 2. Tracking Number & Current Status -->
            <div class="bg-white p-4 border-bottom text-center">
                <span class="badge ${sBadge} fs-6 px-3 py-2 rounded-pill mb-2">${s.status}</span>
                <h3 class="fw-bold mb-0" style="word-break: break-all;">${s.tracking_number}</h3>
            </div>
            
            <!-- 3. Route -->
            <div class="bg-white p-3 border-bottom d-flex align-items-center justify-content-between">
                <div class="text-center w-50">
                    <div class="small text-muted text-uppercase fw-bold">Origin</div>
                    <div class="fw-bold text-truncate">${s.senders?.city || 'Unknown'}</div>
                </div>
                <span class="material-symbols-rounded text-ups-yellow" style="font-size:2rem">arrow_right_alt</span>
                <div class="text-center w-50">
                    <div class="small text-muted text-uppercase fw-bold">Destination</div>
                    <div class="fw-bold text-truncate">${s.receivers?.city || 'Unknown'}</div>
                </div>
            </div>
            
            <!-- 4. Sender -->
            <div class="bg-white mt-2 border-top border-bottom">
                <div class="p-3 fw-bold text-ups-brown d-flex justify-content-between align-items-center" onclick="this.nextElementSibling.classList.toggle('d-none')">
                    <span><span class="material-symbols-rounded align-middle me-2">person</span>Sender</span>
                    <span class="material-symbols-rounded">expand_more</span>
                </div>
                <div class="p-3 pt-0 border-top d-none small">
                    <div class="fw-bold">${s.senders?.full_name || 'N/A'}</div>
                    <div class="text-muted">${s.senders?.address || ''} ${s.senders?.city || ''}, ${s.senders?.country || ''}</div>
                    <div class="text-muted mt-1">${s.senders?.phone || ''}</div>
                </div>
            </div>

            <!-- 5. Receiver -->
            <div class="bg-white mt-2 border-top border-bottom">
                <div class="p-3 fw-bold text-ups-brown d-flex justify-content-between align-items-center" onclick="this.nextElementSibling.classList.toggle('d-none')">
                    <span><span class="material-symbols-rounded align-middle me-2">person_pin_circle</span>Receiver</span>
                    <span class="material-symbols-rounded">expand_more</span>
                </div>
                <div class="p-3 pt-0 border-top d-none small">
                    <div class="fw-bold">${s.receivers?.full_name || 'N/A'}</div>
                    <div class="text-muted">${s.receivers?.address || ''} ${s.receivers?.city || ''}, ${s.receivers?.postal_code || ''} ${s.receivers?.country || ''}</div>
                    <div class="text-muted mt-1">${s.receivers?.phone || ''}</div>
                </div>
            </div>
            
            <!-- 6. Package -->
            <div class="bg-white mt-2 border-top border-bottom">
                <div class="p-3 fw-bold text-ups-brown d-flex justify-content-between align-items-center" onclick="this.nextElementSibling.classList.toggle('d-none')">
                    <span><span class="material-symbols-rounded align-middle me-2">inventory_2</span>Package Info</span>
                    <span class="material-symbols-rounded">expand_more</span>
                </div>
                <div class="p-3 pt-0 border-top d-none small">
                    <div class="mb-1"><strong>Weight:</strong> ${s.packages?.weight || '0'} lbs</div>
                    <div><strong>Description:</strong> ${s.packages?.description || 'N/A'}</div>
                </div>
            </div>
            
            <!-- 7. Tracking Timeline -->
            <div class="bg-white mt-2 p-3 border-top border-bottom">
                <div class="fw-bold text-ups-brown mb-3"><span class="material-symbols-rounded align-middle me-2">timeline</span>Transit History</div>
                ${timelineHtml}
            </div>
            
            <!-- 8 & 9. Payment & Support (Role Based) -->
            ${paymentsHtml}
            ${supportHtml}

            <!-- 10. Available Actions -->
            <div class="p-3 mt-2 mb-4">
                <h6 class="text-muted fw-bold small mb-2 ms-1">ACTIONS</h6>
                <div class="d-flex flex-column gap-2">
                    ${(currentStaffRole === 'Admin' || currentStaffRole === 'Operations Staff') ? `
                        <button class="btn btn-ups w-100 shadow-sm" onclick="openUpdateModal('${s.id}', '${s.status}')">Log Transit Event</button>
                    ` : ''}
                    <a href="index.html?tracking=${s.tracking_number}" target="_blank" class="btn btn-outline-ups w-100 bg-white">View Public Tracking</a>
                </div>
            </div>
        `;
        
    } catch(err) {
        content.innerHTML = `
            <div class="p-5 text-center text-muted">
                <span class="material-symbols-rounded d-block text-danger mb-2" style="font-size:3rem">error</span>
                <h5 class="fw-bold text-dark">Shipment Not Found</h5>
                <p>${err.message}</p>
            </div>
        `;
    }
}

function openUpdateModal(shipmentId, currentStatus) {
    document.getElementById('m-update-id').value = shipmentId;
    document.getElementById('m-update-status').value = currentStatus;
    document.getElementById('m-update-location').value = '';
    document.getElementById('m-update-desc').value = '';
    
    new bootstrap.Modal(document.getElementById('updateTrackingModal')).show();
}

async function submitMobileTrackingUpdate() {
    const id = document.getElementById('m-update-id').value;
    const status = document.getElementById('m-update-status').value;
    const location = document.getElementById('m-update-location').value;
    const desc = document.getElementById('m-update-desc').value;
    
    try {
        // Update shipment status
        await window.supabase.from('shipments').update({ status }).eq('id', id);
        
        // Add event
        const { error } = await window.supabase.from('tracking_events').insert([{
            shipment_id: id,
            status: status,
            location: location || 'System Update',
            description: desc || `Status updated to ${status}`
        }]);
        
        if (error) throw error;
        
        showToast("Tracking updated successfully!");
        bootstrap.Modal.getInstance(document.getElementById('updateTrackingModal')).hide();
        
        // Update UI badge if visible
        const badge = document.getElementById(`search-status-${id}`);
        if (badge) badge.textContent = status;
        
    } catch (err) {
        alert(err.message);
    }
}

// Push Notification Helper
function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function requestAndRegisterPush(userId) {
    if (window.Capacitor) {
        try {
            const PushNotifications = window.Capacitor.Plugins.PushNotifications;
            
            // 1. Request Permission
            let permStatus = await PushNotifications.checkPermissions();
            if (permStatus.receive === 'prompt') {
                permStatus = await PushNotifications.requestPermissions();
            }
            if (permStatus.receive !== 'granted') return;
            
            // Create Notification Channels (Android 8.0+)
            try {
                // Critical operational notifications
                await PushNotifications.createChannel({
                    id: 'critical_ops',
                    name: 'Critical Operations',
                    description: 'Urgent operational issues requiring immediate attention',
                    importance: 4, // High importance (heads-up popup, sound)
                    visibility: 1
                });

                // Payment review
                await PushNotifications.createChannel({
                    id: 'payment_review',
                    name: 'Payment Review',
                    description: 'Notifications for pending shipment payments',
                    importance: 3, // Default importance (sound, no popup)
                    visibility: 1
                });

                // Customer support
                await PushNotifications.createChannel({
                    id: 'customer_support',
                    name: 'Customer Support',
                    description: 'New support tickets and customer replies',
                    importance: 3, // Default importance
                    visibility: 1
                });

                // General operational updates
                await PushNotifications.createChannel({
                    id: 'general_ops',
                    name: 'General Updates',
                    description: 'Standard shipment routing and operational updates',
                    importance: 3, // Default importance
                    visibility: 1
                });
            } catch (channelErr) {
                console.log('Notification channels not supported or failed to create:', channelErr);
            }
            
            // 5. Error handling
            PushNotifications.addListener('registrationError', (error) => {
                console.error('Native push registration error:', error);
            });

            // 6. Basic notification receive handling (foreground)
            PushNotifications.addListener('pushNotificationReceived', (notification) => {
                console.log('Native push received in foreground:', notification);
            });
            
            // Deep linking from notification tap
            PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                const data = action.notification.data;
                if (data && data.event_type) {
                    executePushRoute(data);
                }
            });

            // 2 & 3 & 4. Register, Token Retrieval, and Token Refresh
            PushNotifications.addListener('registration', async (token) => {
                const subStr = token.value;
                const { data: existing } = await window.supabase
                    .from('admin_devices')
                    .select('id')
                    .eq('device_token', subStr)
                    .single();
                    
                if (!existing) {
                    await window.supabase.from('admin_devices').insert({
                        admin_id: userId,
                        device_token: subStr,
                        platform: 'android'
                    });
                    console.log('Android Native Push registered securely');
                } else {
                    await window.supabase.from('admin_devices').update({ 
                        updated_at: new Date().toISOString(), 
                        last_active: new Date().toISOString(),
                        is_active: true 
                    }).eq('device_token', subStr);
                }
            });

            // Execute the registration
            await PushNotifications.register();
            
        } catch (e) {
            console.error('Android Push Init Error:', e);
        }
        return;
    }
    
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
        
        const sw = await navigator.serviceWorker.ready;
        
        let subscription = await sw.pushManager.getSubscription();
        if (!subscription) {
            const vapidPublicKey = 'BAIUqe8JsGAaxq2rpgOWaKH50Xvbzli0et9qUtEBauuOsK876DGxNHvAgzXD68cHMRrZd7LfmAs6wThDbkkh924';
            subscription = await sw.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8Array(vapidPublicKey)
            });
        }
        
        const subStr = JSON.stringify(subscription);
        
        // Use an upsert logic or explicit check
        const { data: existing } = await window.supabase
            .from('admin_devices')
            .select('id')
            .eq('device_token', subStr)
            .single();
            
        if (!existing) {
            await window.supabase.from('admin_devices').insert({
                admin_id: userId,
                device_token: subStr,
                platform: 'web'
            });
            console.log('Push device registered securely');
        } else {
            await window.supabase.from('admin_devices').update({
                updated_at: new Date().toISOString(),
                last_active: new Date().toISOString(),
                is_active: true
            }).eq('device_token', subStr);
        }
    } catch (err) {
        console.error('Failed to register push device:', err);
    }
}

async function requestPushManually() {
    const { data: { session } } = await window.supabase.auth.getSession();
    if (!session) return;
    
    // Call the original registration function which handles permission prompting
    await requestAndRegisterPush(session.user.id);
    
    // Hide the banner if permission was granted or denied
    if (Notification.permission !== 'default') {
        const banner = document.getElementById('push-permission-banner');
        if(banner) banner.classList.add('d-none');
    }
}

// ==========================================
// PAYMENT ACCOUNTS MANAGEMENT (MOBILE)
// ==========================================
let mobileGlobalAccounts = [];

async function loadMobileAccounts() {
    const container = document.getElementById('accounts-list');
    container.innerHTML = '<div class="p-4 text-center text-muted"><div class="spinner-border spinner-border-sm text-ups-brown mb-2"></div><br>Loading accounts...</div>';

    try {
        const { data, error } = await window.supabase
            .from('bank_accounts')
            .select('id, bank_name, account_name, account_number, account_type, is_active, created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;
        mobileGlobalAccounts = data || [];

        container.innerHTML = '';

        if (mobileGlobalAccounts.length === 0) {
            container.innerHTML = '<div class="p-4 text-center text-muted">No payment accounts configured yet.<br><br><button class="btn btn-ups btn-sm" onclick="openAddAccountModal()">Add First Account</button></div>';
            return;
        }

        mobileGlobalAccounts.forEach(acc => {
            const date = new Date(acc.created_at).toLocaleDateString();
            const badge = acc.is_active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Inactive</span>';
            const toggleLabel = acc.is_active ? 'Deactivate' : 'Activate';
            const toggleClass = acc.is_active ? 'btn-outline-danger' : 'btn-outline-success';

            const card = document.createElement('div');
            card.className = 'shipment-card mx-3 mb-3';
            card.innerHTML = `
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div class="fw-bold">${acc.bank_name}</div>
                    ${badge}
                </div>
                <div class="small text-muted mb-1">${acc.account_name}</div>
                <div class="small fw-bold text-dark mb-2" style="letter-spacing: 1px;">${acc.account_number}${acc.account_type ? ' · ' + acc.account_type : ''}</div>
                <div class="small text-muted mb-3">Added ${date}</div>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-secondary rounded flex-grow-1" onclick="openEditAccountModal('${acc.id}')">Edit</button>
                    <button class="btn btn-sm ${toggleClass} rounded flex-grow-1" onclick="toggleMobileAccountStatus('${acc.id}', ${acc.is_active})">${toggleLabel}</button>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        showToast('Error loading accounts: ' + err.message);
        container.innerHTML = '<div class="p-4 text-center text-danger">Error loading accounts</div>';
    }
}

function openAddAccountModal() {
    document.getElementById('account-modal-title').textContent = 'Add Payment Account';
    document.getElementById('account-form').reset();
    document.getElementById('account-edit-id').value = '';
    document.getElementById('account-modal-error').classList.add('d-none');
    document.getElementById('account-save-btn').textContent = 'Add Account';
    new bootstrap.Modal(document.getElementById('accountModal')).show();
}

function openEditAccountModal(id) {
    const acc = mobileGlobalAccounts.find(a => a.id === id);
    if (!acc) return;

    document.getElementById('account-modal-title').textContent = 'Edit Payment Account';
    document.getElementById('account-edit-id').value = acc.id;
    document.getElementById('m-acc-bank-name').value = acc.bank_name;
    document.getElementById('m-acc-account-name').value = acc.account_name;
    document.getElementById('m-acc-account-number').value = acc.account_number;
    document.getElementById('m-acc-account-type').value = acc.account_type || '';
    document.getElementById('m-acc-is-active').checked = acc.is_active;
    document.getElementById('account-modal-error').classList.add('d-none');
    document.getElementById('account-save-btn').textContent = 'Save Changes';
    new bootstrap.Modal(document.getElementById('accountModal')).show();
}

async function saveMobileAccount(e) {
    e.preventDefault();
    const btn = document.getElementById('account-save-btn');
    const errBox = document.getElementById('account-modal-error');
    errBox.classList.add('d-none');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const editId = document.getElementById('account-edit-id').value;
    const isActive = document.getElementById('m-acc-is-active').checked;
    const payload = {
        bank_name: document.getElementById('m-acc-bank-name').value.trim(),
        account_name: document.getElementById('m-acc-account-name').value.trim(),
        account_number: document.getElementById('m-acc-account-number').value.trim(),
        account_type: document.getElementById('m-acc-account-type').value || null,
        is_active: isActive,
        updated_at: new Date().toISOString()
    };

    try {
        // If activating, deactivate all others
        if (isActive) {
            const { error: deactivateError } = await window.supabase
                .from('bank_accounts')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .neq('id', editId || '00000000-0000-0000-0000-000000000000');
            if (deactivateError) throw deactivateError;
        }

        if (editId) {
            const { error } = await window.supabase
                .from('bank_accounts')
                .update(payload)
                .eq('id', editId);
            if (error) throw error;
        } else {
            const { error } = await window.supabase
                .from('bank_accounts')
                .insert([payload]);
            if (error) throw error;
        }

        showToast(editId ? 'Account updated!' : 'Account added!');
        bootstrap.Modal.getInstance(document.getElementById('accountModal')).hide();
        await loadMobileAccounts();
    } catch (err) {
        errBox.textContent = 'Error: ' + (err.message || 'Unknown error');
        errBox.classList.remove('d-none');
    } finally {
        btn.disabled = false;
        btn.textContent = editId ? 'Save Changes' : 'Add Account';
    }
}

async function toggleMobileAccountStatus(id, wasActive) {
    try {
        const { error } = await window.supabase
            .from('bank_accounts')
            .update({ is_active: !wasActive, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;

        // If was activating, deactivate others
        if (!wasActive) {
            await window.supabase
                .from('bank_accounts')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .neq('id', id);
        }

        showToast(wasActive ? 'Account deactivated' : 'Account activated');
        await loadMobileAccounts();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}
