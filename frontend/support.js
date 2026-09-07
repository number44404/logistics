let globalTickets = [];
let activeTicketId = null;
let activeThreadChannel = null; // Realtime channel for the open ticket thread
let activeThreadPolling = null; // Polling fallback for the open thread

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
});

async function checkAuth() {
    const { data: { session } } = await window.supabase.auth.getSession();
    if (session) {
        document.getElementById('login-overlay').style.display = 'none';
        await verifyRoleAndLoad(session.user.id);
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
    }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-auth-btn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    try {
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

let currentStaffRole = null;

async function verifyRoleAndLoad(userId) {
    // Check RBAC table
    const { data: staff, error } = await window.supabase
        .from('staff_users')
        .select('role')
        .eq('id', userId)
        .single();
        
    if (error || !staff) {
        alert("Access Denied: You do not have an active staff role in the system.");
        await window.supabase.auth.signOut();
        document.getElementById('login-overlay').style.display = 'flex';
        return;
    }
    
    currentStaffRole = staff.role;
    
    // Both Admin and Customer Care Agents can access this dashboard
    if (currentStaffRole !== 'Admin' && currentStaffRole !== 'Customer Care Agent') {
        alert("Access Denied: Role not authorized for Support Dashboard.");
        await window.supabase.auth.signOut();
        document.getElementById('login-overlay').style.display = 'flex';
        return;
    }
    
    // Authorized! Load app
    await loadQueue();
    requestNotificationPermission();
    
    // Global realtime: watch ticket_replies for ANY new customer message
    // so we can fire a browser notification even when the agent is on another ticket
    window.supabase
        .channel('global-customer-messages')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'ticket_replies' },
            (payload) => {
                const reply = payload.new;
                if (!reply) return;

                // Only notify for customer messages (not the agent's own replies)
                if (reply.sender_type !== 'customer') return;

                // Also refresh the queue list so unread indicator updates
                loadQueue();

                // If the message is on the currently open ticket, refresh the thread
                if (reply.ticket_id === activeTicketId) {
                    loadThreadMessages(activeTicketId);
                }

                // Fire a browser notification
                const ticket = globalTickets.find(t => t.id === reply.ticket_id);
                const customerName = ticket?.sender_name || 'A customer';
                fireNotification(
                    `New message from ${customerName}`,
                    reply.message.replace(/\[ATTACHMENT\]\(.*?\)/g, '📎 Image').substring(0, 100)
                );
            }
        )
        .subscribe();

    // Legacy notification_log channel (kept for backward compat)
    window.supabase
        .channel('support-notifications')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notifications_log' },
            (payload) => {
                const alert = payload.new;
                if (alert.event_type === 'support_ticket_created') {
                    loadQueue();
                    fireNotification('New Support Ticket', alert.body || 'A customer opened a new ticket.');
                }
            }
        )
        .subscribe();
}

function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function fireNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const n = new Notification(title, {
        body: body || '',
        icon: 'img/ups-logo.svg',
        tag: 'support-msg',       // replaces previous notification if agent hasn't clicked it
        renotify: true
    });

    // Clicking the notification focuses the tab
    n.onclick = () => {
        window.focus();
        n.close();
    };
}

async function logout() {
    await window.supabase.auth.signOut();
    window.location.reload();
}

async function loadQueue() {
    try {
        const { data, error } = await window.supabase
            .from('support_tickets')
            .select(`
                *,
                shipments (
                    id, tracking_number, status, payment_status, shipping_fee,
                    senders (city, country),
                    receivers (full_name, email, phone, address, city, postal_code, country)
                )
            `)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        globalTickets = data;
        
        updateStats();
        renderQueue();
    } catch (err) {
        document.getElementById('ticket-list').innerHTML = `<div class="p-4 text-danger text-center">Error loading queue: ${err.message}</div>`;
    }
}

function updateStats() {
    document.getElementById('stat-total').textContent = globalTickets.filter(t => t.status !== 'closed').length;
    document.getElementById('stat-pending').textContent = globalTickets.filter(t => t.status === 'pending').length;
    document.getElementById('stat-active').textContent = globalTickets.filter(t => t.assigned_agent !== 'Unassigned' && t.status === 'open').length;
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('stat-resolved').textContent = globalTickets.filter(t => t.status === 'resolved' && t.updated_at.startsWith(today)).length;
}

function renderQueue() {
    const list = document.getElementById('ticket-list');
    const search = document.getElementById('search-input').value.toLowerCase();
    const filter = document.getElementById('status-filter').value;
    
    let filtered = globalTickets.filter(t => {
        const tracking = (t.shipments?.tracking_number || "").toLowerCase();
        const email = (t.sender_email || "").toLowerCase();
        const phone = (t.shipments?.receivers?.phone || "").toLowerCase();
        
        const matchesSearch = tracking.includes(search) || email.includes(search) || phone.includes(search);
        const matchesFilter = filter === 'all' || t.status === filter;
        
        return matchesSearch && matchesFilter;
    });
    
    list.innerHTML = '';
    
    if (filtered.length === 0) {
        list.innerHTML = `<div class="p-4 text-muted text-center">No tickets found.</div>`;
        return;
    }
    
    filtered.forEach(t => {
        const div = document.createElement('div');
        div.className = `ticket-item ${t.id === activeTicketId ? 'active' : ''}`;
        div.onclick = () => openTicket(t.id);
        
        let statusColor = 'bg-secondary';
        if (t.status === 'open') statusColor = 'bg-danger';
        if (t.status === 'pending') statusColor = 'bg-warning text-dark';
        if (t.status === 'resolved') statusColor = 'bg-success';
        
        const tracking = t.shipments?.tracking_number || 'No Tracking';
        
        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-start mb-1">
                <strong class="text-truncate" style="max-width:70%">${t.subject}</strong>
                <span class="badge ${statusColor} rounded-pill" style="font-size: 0.7rem;">${t.status}</span>
            </div>
            <div class="small text-muted d-flex justify-content-between">
                <span>${t.sender_name}</span>
                <span class="fw-bold">${tracking}</span>
            </div>
        `;
        list.appendChild(div);
    });
}

async function openTicket(ticketId) {
    activeTicketId = ticketId;
    renderQueue(); // Update active state
    
    // Tear down previous thread subscription if any
    if (activeThreadChannel) {
        window.supabase.removeChannel(activeThreadChannel);
        activeThreadChannel = null;
    }
    if (activeThreadPolling) {
        clearInterval(activeThreadPolling);
        activeThreadPolling = null;
    }

    // Subscribe to new replies for this ticket so the UI updates instantly
    activeThreadChannel = window.supabase
        .channel('thread-replies-' + ticketId)
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'ticket_replies' },
            (payload) => {
                if (payload.new && payload.new.ticket_id === ticketId) {
                    loadThreadMessages(ticketId);
                }
            }
        )
        .subscribe();

    // Polling fallback: catches any messages realtime might miss
    activeThreadPolling = setInterval(() => {
        if (activeTicketId === ticketId) loadThreadMessages(ticketId);
    }, 4000);

    const ticket = globalTickets.find(t => t.id === ticketId);
    if (!ticket) return;
    
    // Toggle UI panes
    document.getElementById('empty-state').classList.add('d-none');
    document.getElementById('active-thread').classList.remove('d-none');
    document.getElementById('context-empty').classList.add('d-none');
    document.getElementById('context-profile').classList.remove('d-none');
    
    // Populate Header
    document.getElementById('thread-subject').textContent = ticket.subject;
    document.getElementById('thread-category').textContent = ticket.category;
    document.getElementById('thread-agent').textContent = ticket.assigned_agent;
    document.getElementById('thread-status').value = ticket.status;
    
    // Populate Context (Right Pane)
    const s = ticket.shipments;
    const r = s?.receivers;
    
    if (r) {
        document.getElementById('ctx-initial').textContent = r.full_name.charAt(0).toUpperCase();
        document.getElementById('ctx-name').textContent = r.full_name;
        document.getElementById('ctx-email').textContent = r.email || ticket.sender_email;
        document.getElementById('ctx-phone').textContent = r.phone || 'Not provided';
        document.getElementById('ctx-address').textContent = `${r.address || ''}, ${r.city || ''} ${r.postal_code || ''}, ${r.country || ''}`;
    } else {
        document.getElementById('ctx-initial').textContent = '?';
        document.getElementById('ctx-name').textContent = ticket.sender_name;
        document.getElementById('ctx-email').textContent = ticket.sender_email;
        document.getElementById('ctx-phone').textContent = 'Not provided';
        document.getElementById('ctx-address').textContent = 'Address not provided';
    }
    
    if (s) {
        document.getElementById('ctx-tracking').textContent = s.tracking_number;
        document.getElementById('ctx-track-link').href = `index.html?tracking=${s.tracking_number}`;
        
        let sBadge = 'bg-secondary';
        if (s.status === 'Delivered') sBadge = 'bg-success';
        if (s.status === 'In Transit') sBadge = 'bg-primary';
        document.getElementById('ctx-ship-status').className = `badge ${sBadge}`;
        document.getElementById('ctx-ship-status').textContent = s.status || 'Pending';
        
        const origin = s.senders ? `${s.senders.city}, ${s.senders.country}` : 'Unknown Origin';
        document.getElementById('ctx-origin').textContent = origin;
        
        // Payment
        let pBadge = 'bg-secondary';
        if (s.payment_status === 'paid') pBadge = 'bg-success';
        if (s.payment_status === 'pending_verification') pBadge = 'bg-warning text-dark';
        document.getElementById('ctx-pay-status').className = `badge ${pBadge}`;
        document.getElementById('ctx-pay-status').textContent = s.payment_status || 'Unpaid';
        document.getElementById('ctx-pay-amount').textContent = `$${(s.shipping_fee || 0).toFixed(2)}`;
        
        // Check for payments row
        const { data: payments } = await window.supabase.from('payments').select('receipt_url').eq('shipment_id', s.id).order('created_at', { ascending: false }).limit(1);
        if (payments && payments.length > 0 && payments[0].receipt_url) {
            document.getElementById('ctx-receipt-container').classList.remove('d-none');
            document.getElementById('ctx-receipt-btn').href = payments[0].receipt_url;
        } else {
            document.getElementById('ctx-receipt-container').classList.add('d-none');
        }
    }
    
    await loadThreadMessages(ticketId);
}

async function loadThreadMessages(ticketId) {
    const container = document.getElementById('thread-messages');
    container.innerHTML = '<div class="text-center text-muted mt-5">Loading thread...</div>';
    
    try {
        const { data: replies, error } = await window.supabase
            .from('ticket_replies')
            .select('*')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true });
            
        if (error) throw error;
        
        container.innerHTML = '';
        
        // Inject original ticket creation as first message
        const ticket = globalTickets.find(t => t.id === ticketId);
        // We actually only have replies. Wait, the original message is the first reply.
        
        if (!replies || replies.length === 0) {
            container.innerHTML = '<div class="text-center text-muted mt-5">No messages.</div>';
            return;
        }
        
        replies.forEach(r => {
            const isInternal = r.sender_type === 'internal';
            const isAdmin = r.sender_type === 'admin' || isInternal;
            const date = new Date(r.created_at).toLocaleString();
            
            const bubbleClass = isInternal ? 'bubble-internal' : (isAdmin ? 'bubble-admin' : 'bubble-customer');
            const senderName = isInternal ? 'Internal Note (Hidden)' : (isAdmin ? 'Support Agent' : ticket.sender_name);
            const icon = isInternal ? 'visibility_off' : (isAdmin ? 'support_agent' : 'person');
            
            // Escape HTML first, then parse [ATTACHMENT](url) into inline images
            let msgContent = r.message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const attachmentRegex = /\[ATTACHMENT\]\((.*?)\)/g;
            msgContent = msgContent.replace(attachmentRegex, '<br><a href="$1" target="_blank"><img src="$1" style="max-width: 100%; max-height: 200px; margin-top: 10px; border-radius: 8px; border: 1px solid #ddd; object-fit: contain;" alt="Attachment"></a>');
            
            const div = document.createElement('div');
            div.className = `bubble ${bubbleClass}`;
            div.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <strong class="small d-flex align-items-center gap-1">
                        <span class="material-symbols-rounded" style="font-size:16px;">${icon}</span>
                        ${senderName}
                    </strong>
                    <small class="text-muted" style="font-size:0.7rem">${date}</small>
                </div>
                <div style="white-space: pre-wrap; font-size: 0.95rem;">${msgContent}</div>
            `;
            container.appendChild(div);
        });
        
        container.scrollTop = container.scrollHeight;
        
    } catch (err) {
        container.innerHTML = `<div class="text-danger text-center mt-5">Error: ${err.message}</div>`;
    }
}

async function sendReply(e) {
    e.preventDefault();
    if (!activeTicketId) return;
    
    const btn = document.getElementById('btn-send');
    const input = document.getElementById('reply-input');
    const type = document.querySelector('input[name="replyType"]:checked').value;
    let msg = input.value.trim();
    if (!msg) return;
    
    btn.disabled = true;
    
    try {
        const fileInput = document.getElementById('reply-image');
        if (fileInput && fileInput.files.length > 0) {
            btn.textContent = 'Uploading...';
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `support_${Date.now()}.${fileExt}`;
            
            const { data: uploadData, error: uploadError } = await window.supabase
                .storage.from('receipts').upload(fileName, file, { cacheControl: '3600', upsert: false });
            if (uploadError) throw uploadError;
            
            const { data: publicUrlData } = window.supabase.storage.from('receipts').getPublicUrl(fileName);
            msg += `\n\n[ATTACHMENT](${publicUrlData.publicUrl})`;
        }
        btn.textContent = 'Sending...';

        const { error } = await window.supabase
            .from('ticket_replies')
            .insert([{
                ticket_id: activeTicketId,
                sender_type: type,
                message: msg
            }]);
            
        if (error) throw error;
        
        input.value = '';
        const fileInput = document.getElementById('reply-image');
        if (fileInput) fileInput.value = '';
        
        // Auto-assign to me if unassigned and replying
        const ticket = globalTickets.find(t => t.id === activeTicketId);
        if (ticket && ticket.assigned_agent === 'Unassigned') {
            await assignToMe();
        }
        
        await loadThreadMessages(activeTicketId);
        
    } catch (err) {
        alert("Error sending reply: " + err.message);
    } finally {
        btn.disabled = false;
    }
}

async function updateTicketStatus(newStatus) {
    if (!activeTicketId) return;
    try {
        const { error } = await window.supabase
            .from('support_tickets')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', activeTicketId);
            
        if (error) throw error;
        
        const t = globalTickets.find(x => x.id === activeTicketId);
        if (t) t.status = newStatus;
        
        updateStats();
        renderQueue(); // Refresh left panel colors
    } catch (err) {
        alert("Error updating status: " + err.message);
    }
}

async function assignToMe() {
    if (!activeTicketId) return;
    try {
        const agentName = "Admin Agent"; // In real app, fetch from auth
        const { error } = await window.supabase
            .from('support_tickets')
            .update({ assigned_agent: agentName, status: 'pending', updated_at: new Date().toISOString() })
            .eq('id', activeTicketId);
            
        if (error) throw error;
        
        const t = globalTickets.find(x => x.id === activeTicketId);
        if (t) t.assigned_agent = agentName;
        
        document.getElementById('thread-agent').textContent = agentName;
        updateStats();
    } catch (err) {
        alert("Error assigning ticket: " + err.message);
    }
}
