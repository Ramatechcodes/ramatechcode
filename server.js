const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
require("dotenv").config();

const db = require("./firebase");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));


app.post("/register", async (req, res) => {
    try {

        const data = req.body;

        // Save to Firebase Firestore
        await db.collection("students").add(data);

        // Send email
   const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 2525,
    secure: false,
    requireTLS: true,
    auth: {
        user: process.env.BREVO_USER,
        pass: process.env.BREVO_PASS
    }
});
        await transporter.sendMail({
    from: `"Ramatechcode Lab" <${process.env.EMAIL}>`,
    to: data.email,
    subject: "Welcome to Ramatechcode Lab 🚀",
    html: `
        <div style="font-family:Arial;padding:20px;line-height:1.6">
            
            <h2 style="color:#0ea5e9;">Welcome to Ramatechcode Lab 🚀</h2>

            <p>Hello <b>${data.fullname}</b>,</p>

            <p>
                Thank you for registering for our <b>FREE 3 Months Tech Training</b>.
            </p>

            <p>
                You selected:  
                <b style="color:#22c55e;">${data.interest}</b> class
            </p>

            <p>
                Class Type: <b>${data.classOption}</b>
            </p>

            <h3>What you will learn:</h3>

            <ul>
                <li>Real-world project building</li>
                <li>Hands-on coding practice</li>
                <li>Portfolio development</li>
                <li>AI + Automation skills</li>
                <li>Job-ready training</li>
                 <li>How to get and work remotely</li>
            </ul>

            <p>
                Our team will contact you soon via email or WhatsApp.
            </p>

            <hr>

            <p style="color:gray">
                Ramatechcode Lab - Building Future Developers 🚀
            </p>

        </div>
    `
});
        res.json({ message: "Registration successful" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
