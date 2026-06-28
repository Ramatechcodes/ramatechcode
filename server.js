require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const axios = require("axios");

const ADMIN_PIN = process.env.ADMIN_PIN;
const db = require("./firebase");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ADMIN AUTH MIDDLEWARE
function verifyPin(req, res, next){
    const pin = req.headers["admin-pin"];
    if(pin !== ADMIN_PIN){
        return res.status(401).json({ error: "Invalid Access PIN" });
    }
    next();
}

// Mail Transporter Helper
function getMailTransporter() {
    return nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 2525,
        secure: false,
        requireTLS: true,
        auth: {
            user: process.env.BREVO_USER,
            pass: process.env.BREVO_PASS
        }
    });
}

// ==========================================
// STEP 1: INITIALIZE REGISTRATION (WITH DUPLICATE CHECK)
// ==========================================
app.post("/register", async (req, res) => {
    try {
        const data = req.body;
        
        // -------------------------------------------------------------
        // DUPLICATION CHECK: Validate Email and Phone uniqueness
        // -------------------------------------------------------------
        const emailCheck = await db.collection("students")
            .where("email", "==", data.email.trim())
            .where("paymentStatus", "==", "paid")
            .get();

        const phoneCheck = await db.collection("students")
            .where("phone", "==", data.phone.trim())
            .where("paymentStatus", "==", "paid")
            .get();

        if (!emailCheck.empty || !phoneCheck.empty) {
            return res.status(400).json({ 
                error: "This profile has already registered and verified their payment context." 
            });
        }
        // -------------------------------------------------------------

        data.createdAt = new Date().toISOString();

        // Unique transaction reference
        const tx_ref = `RAMA_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');

        const payload = {
            tx_ref: tx_ref,
            amount: 2500,
            currency: "NGN",
            redirect_url: `${protocol}://${host}/payment-callback`, 
            payment_options: "card, banktransfer, ussd",
            customer: {
                email: data.email,
                phonenumber: data.phone,
                name: data.fullname
            },
            customizations: {
                title: "Ramatechcode Lab",
                description: "Technology Training Center Application Fee",
                logo: "https://ramatechcode-student-portal.onrender.com/images/logo.png"
            }
        };

        const response = await axios.post(
            "https://api.flutterwave.com/v3/payments",
            payload,
            { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, "Content-Type": "application/json" } }
        );

        if (response.data.status === "success") {
            // Save data with a default "pending" status
            await db.collection("students").add({
                ...data,
                paymentStatus: "pending",
                amountPaid: 0,
                tx_ref: tx_ref
            });

            return res.json({ 
                message: "Registration initiated! Redirecting to secure payment...", 
                redirectUrl: response.data.data.link 
            });
        } else {
            return res.status(400).json({ error: "Could not initialize payment gateway link." });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.response?.data?.message || error.message });
    }
});

// ==========================================
// STEP 2: VERIFY FLUTTERWAVE TRANSACTION & SEND EMAIL
// ==========================================
app.get("/payment-callback", async (req, res) => {
    const { status, tx_ref, transaction_id } = req.query;

    if (status === "cancelled" || !transaction_id) {
        return res.send(`<h2>Payment was cancelled or failed. Please return to the homepage and retry.</h2>`);
    }

    try {
        const response = await axios.get(
            `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
            { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
        );

        const flwData = response.data.data;

        if (response.data.status === "success" && flwData.status === "successful" && flwData.amount >= 2500) {
            
            const studentQuery = await db.collection("students").where("tx_ref", "==", tx_ref).limit(1).get();

            if (!studentQuery.empty) {
                const docRef = studentQuery.docs[0].ref;
                const studentData = studentQuery.docs[0].data();

                if (studentData.paymentStatus !== "paid") {
                    
                    await docRef.update({
                        paymentStatus: "paid",
                        amountPaid: flwData.amount,
                        flw_transaction_id: transaction_id
                    });

                    const transporter = getMailTransporter();
                    await transporter.sendMail({
                        from: `"Ramatechcode Lab" <${process.env.EMAIL}>`,
                        to: studentData.email,
                        subject: "Welcome to Ramatechcode Lab 🚀",
                        html: `
                            <div style="font-family:Arial;padding:20px;line-height:1.6">
                                <h2 style="color:#0ea5e9;">Payment Confirmed! Welcome to Ramatechcode Lab 🚀</h2>
                                <p>Hello <b>${studentData.fullname}</b>,</p>
                                <p>Thank you for registering for our <b>1 Month Intensive Tech Training</b>. Your payment of <b>NGN ${flwData.amount}</b> has been successfully received.</p>
                                <p>You selected: <b style="color:#22c55e;">${studentData.interest}</b> class (${studentData.classOption})</p>
                                <h3>What happens next?</h3>
                                <ul>
                                    <li>Your profile configuration details are being finalized.</li>
                                    <li>Onboarding community portal credentials will follow shortly.</li>
                                    <li>Click on this link to register for your student portal: <a href="https://ramatechcode-student-portal.onrender.com">Student Portal</a></li>
                                </ul>
                                <hr>
                                <p style="color:gray">Ramatechcode Lab - Building Future Developers 🚀</p>
                            </div>
                        `
                    });
                }

                return res.send(`
                    <script>
                        alert("Payment successful! Slot verified and email sent.");
                        window.location.href = "/";
                    </script>
                `);
            } else {
                return res.send(`<h2>Transaction verified but registration reference wasn't tracked.</h2>`);
            }
        } else {
            return res.send(`<h2>Security payload mismatch processing payment confirmation.</h2>`);
        }
    } catch (error) {
        console.error("Verification breakdown: ", error);
        res.status(500).send(`<h2>Internal Payment processing validation error occurred.</h2>`);
    }
});

// ==========================================
// ADMIN METRICS PORT: OBJECT DELIVERY
// ==========================================
app.get("/students", verifyPin, async (req, res) => {
    try {
        const snapshot = await db.collection("students").orderBy("createdAt", "desc").get();
        let students = [];
        let totalRevenue = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            
            if (data.paymentStatus === "paid" && data.amountPaid) {
                totalRevenue += Number(data.amountPaid);
            }

            students.push({
                id: doc.id,
                ...data
            });
        });

        res.json({ students, totalRevenue });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// REMAINING PORTS
app.delete("/students/:id", verifyPin, async (req, res) => {
    try {
        await db.collection("students").doc(req.params.id).delete();
        res.json({ message: "Student deleted" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post("/send-bulk-email", verifyPin, async (req, res) => {
    try {
        const { subject, message } = req.body;
        const snapshot = await db.collection("students").get();
        const emails = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            if(data.email) emails.push(data.email);
        });

        const uniqueEmails = [...new Set(emails)];
        const transporter = getMailTransporter();

        await transporter.sendMail({
            from: `"Ramatechcode Lab" <${process.env.EMAIL}>`,
            to: process.env.EMAIL,
            bcc: uniqueEmails,
            subject: subject,
            html: `<div style="font-family:Arial;padding:20px;line-height:1.7">${message}<br><br><hr><p style="color:gray">Ramatechcode Lab 🚀</p></div>`
        });

        res.json({ message: `Email sent to ${uniqueEmails.length} students` });
    } catch(error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server running on port", PORT));
