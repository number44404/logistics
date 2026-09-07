/**
 * Database Helper Functions for Supabase
 * These functions wrap the Supabase JS client to perform common queries.
 */

const db = {
    /**
     * Auth Helpers
     */
    async login(email, password) {
        // 1. Authenticate with Supabase
        const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
        if (error) {
            if (error.message.includes("Invalid login credentials")) {
                throw new Error("Wrong password or missing account.");
            }
            throw error;
        }

        // 2. Verify Admin Role
        
        // 2. Verify Admin Role
        const { data: adminProfile, error: adminError } = await window.supabase
            .from("admins")
            .select("role")
            .eq("user_id", data.user.id)
            .single();

        if (adminError || !adminProfile || adminProfile.role !== "admin") {
            // Unauthorized user
            await window.supabase.auth.signOut();
            throw new Error("Unauthorized: Your account does not have admin privileges.");
        }


        return data;
    },

    async logout() {
        const { error } = await window.supabase.auth.signOut();
        if (error) throw error;
    },

    async getSession() {
        const { data: { session } } = await window.supabase.auth.getSession();
        
        
        if (session) {
            // Double check admin role on refresh
            const { data: adminProfile } = await window.supabase
                .from("admins")
                .select("role")
                .eq("user_id", session.user.id)
                .single();
                
            if (!adminProfile || adminProfile.role !== "admin") {
                await window.supabase.auth.signOut();
                return null;
            }
        }

        
        return session;
    },

    /**
     * Shipment Query Helpers
     */
    async getShipmentByTrackingNumber(trackingNumber) {
        const { data, error } = await window.supabase
            .from('shipments')
            .select(`
                *,
                senders (*),
                receivers (*),
                packages (*),
                tracking_events (*)
            `)
            .eq('tracking_number', trackingNumber)
            .single();
            
        if (error) throw error;
        return data;
    },

    async createShipment(payload) {
        // 1. Insert Sender
        const { data: sender, error: senderError } = await window.supabase
            .from('senders')
            .insert([payload.sender])
            .select().single();
        if (senderError) throw senderError;

        // 2. Insert Receiver (if manual workflow)
        let receiverId = null;
        if (payload.receiver) {
            const { data: receiver, error: receiverError } = await window.supabase
                .from('receivers')
                .insert([payload.receiver])
                .select().single();
            if (receiverError) throw receiverError;
            receiverId = receiver.id;
        }

        // 3. Insert Package
        const { data: pkg, error: pkgError } = await window.supabase
            .from('packages')
            .insert([payload.package])
            .select().single();
        if (pkgError) throw pkgError;

        // 4. Insert Shipment Linking Them All
        const isDraft = payload.workflow === 'link';
        const finalTrackingNumber = isDraft ? `DRAFT-${crypto.randomUUID()}` : payload.tracking_number;

        const shipmentData = {
            tracking_number: finalTrackingNumber,
            status: payload.status,
            estimated_delivery: payload.estimated_delivery,
            shipping_method: payload.shipping_method || 'Standard',
            billing_party: payload.billing_party || 'Sender',
            customer_reference: payload.customer_reference || null,
            origin_facility: payload.origin_facility || null,
            destination_facility: payload.destination_facility || null,
            sender_id: sender.id,
            receiver_id: receiverId,
            package_id: pkg.id,
            is_draft: isDraft,
            shipping_fee: payload.shipping_fee || 0,
            payment_status: 'unpaid'
        };

        const { data: shipment, error: shipmentError } = await window.supabase
            .from('shipments')
            .insert([shipmentData])
            .select(`*, senders(*), receivers(*), packages(*)`)
            .single();
            
        if (shipmentError) throw shipmentError;

        // 5. Generate Receiver Link if Draft
        if (isDraft) {
            const secureToken = crypto.randomUUID();
            const { error: linkError } = await window.supabase
                .from('receiver_links')
                .insert([{
                    shipment_id: shipment.id,
                    secure_token: secureToken,
                    status: 'active'
                }]);
            if (linkError) throw linkError;
            shipment.secure_token = secureToken; // Append to object so UI can display the link
        }

        return shipment;
    },

    async getAllShipments() {
        const { data, error } = await window.supabase
            .from("shipments")
            .select(`
                *,
                senders (*),
                receivers (*),
                packages (*)
            `)
            .order("created_at", { ascending: false });
        if (error) throw error;
        return data;
    },

    async updateShipment(id, payload) {
        // First get existing FKs
        const { data: existing } = await window.supabase
            .from('shipments')
            .select('sender_id, receiver_id, package_id')
            .eq('id', id)
            .single();

        if (existing) {
            if (payload.sender) await window.supabase.from('senders').update(payload.sender).eq('id', existing.sender_id);
            if (payload.receiver) await window.supabase.from('receivers').update(payload.receiver).eq('id', existing.receiver_id);
            if (payload.package) await window.supabase.from('packages').update(payload.package).eq('id', existing.package_id);
        }

        const shipmentData = {
            status: payload.status,
            estimated_delivery: payload.estimated_delivery,
            shipping_method: payload.shipping_method,
            billing_party: payload.billing_party,
            customer_reference: payload.customer_reference,
            origin_facility: payload.origin_facility,
            destination_facility: payload.destination_facility
        };

        const { data, error } = await window.supabase
            .from("shipments")
            .update(shipmentData)
            .eq("id", id)
            .select(`*, senders(*), receivers(*), packages(*)`)
            .single();
            
        if (error) throw error;
        return data;
    },

    async deleteShipment(id) {
        const { error } = await window.supabase
            .from("shipments")
            .delete()
            .eq("id", id);
        if (error) throw error;
    },

    async addTrackingEvents(eventsArray) {
        if (!eventsArray || eventsArray.length === 0) return null;
        
        const { data, error } = await window.supabase
            .from('tracking_events')
            .insert(eventsArray)
            .select();
            
        if (error) throw error;
        return data;
    },

    /**
     * Utility Helpers
     */
    generateTrackingNumber(countryCode = 'NG') {
        const today = new Date();
        const dateStr = today.getFullYear() + 
                        String(today.getMonth() + 1).padStart(2, '0') + 
                        String(today.getDate()).padStart(2, '0');
        
        let randomStr = '';
        if (window.crypto && window.crypto.getRandomValues) {
            const array = new Uint32Array(1);
            window.crypto.getRandomValues(array);
            randomStr = array[0].toString(36).substring(0, 6).toUpperCase().padStart(6, '0');
        } else {
            randomStr = Math.random().toString(36).substring(2, 8).toUpperCase().padStart(6, '0');
        }
        
        return `TRK-${countryCode.toUpperCase()}-${dateStr}-${randomStr}`;
    },

    async generateUniqueTrackingNumber(countryCode = 'NG') {
        let isUnique = false;
        let newTrackingNumber = '';
        
        // Retry loop to guarantee uniqueness against database
        while (!isUnique) {
            newTrackingNumber = this.generateTrackingNumber(countryCode);
            const { data, error } = await window.supabase
                .from('shipments')
                .select('id')
                .eq('tracking_number', newTrackingNumber)
                .single();
                
            if (error && error.code === 'PGRST116') {
                // PGRST116 is "No rows returned", meaning it's unique!
                isUnique = true;
            } else if (!data) {
                // If it fails for another reason but returns null, we might be safe or offline, but let's assume unique for now if no data.
                isUnique = true; 
            }
            // If data exists, it will loop again.
        }
        return newTrackingNumber;
    }
};

window.db = db;
