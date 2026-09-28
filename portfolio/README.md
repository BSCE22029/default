# Hi, I'm Muhammad Moiz Ahmad 👋

**Full-Stack Developer · Embedded Systems Engineer · Edge AI**  
Computer Engineering @ ITU Lahore · AWS Certified · Available for freelance

[![Portfolio](https://img.shields.io/badge/Portfolio-Live-a855f7?style=for-the-badge&logo=vercel)](https://moiz-ahmad-portfolio.vercel.app)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Moiz_Ahmad-0077B5?style=for-the-badge&logo=linkedin)](https://www.linkedin.com/in/moiz-ahmad-8922651a7/)
[![Email](https://img.shields.io/badge/Email-contact@atronm.com-ea4335?style=for-the-badge&logo=gmail)](mailto:contact@atronm.com)

---

## About Me

I build across the full product stack — from web apps and REST APIs down to FPGA implementations and embedded firmware. My background in Computer Engineering means I understand both the software and the hardware, which lets me work on projects most developers can't: running neural networks on microcontrollers, implementing protocols in Verilog, or building real-time dashboards backed by custom embedded sensors.

- 🌐 **Web**: React, Node.js, Express, Supabase, PostgreSQL, JWT Auth
- ⚙️ **Embedded**: Arduino, STM32, ESP32, C/C++, I2C, SPI, UART
- 🔌 **HDL**: Verilog, FPGA (Xilinx Artix-7), Vivado, ModelSim
- 🤖 **Edge AI**: TensorFlow Lite, MFCC, Conv1D, Autoencoders, INT8 quantization
- 🐍 **AI/ML**: Python, TensorFlow, OpenCV, CNNs, scikit-learn

---

## Featured Projects

### 🌐 Web & SaaS

#### [LeadFlow CRM](https://github.com/BSCE22029/leadflow-crm) — Multi-Tenant B2B CRM SaaS
> React + Vite · Supabase (Auth, RLS, Realtime) · PostgreSQL · Vercel

Full CRM platform with lead management, email automation, analytics dashboard, and Google OAuth. Supports multiple tenant organizations with row-level security. Features a built-in lead generator that discovers prospects via Clearbit and GitHub APIs.

**Tech highlights**: Row-Level Security policies for multi-tenancy, real-time pipeline updates via Supabase Realtime, streaming lead discovery results.

---

#### [REST API Explorer](https://moiz-ahmad-portfolio.vercel.app/projects/rest-api-explorer.html) — Full CRUD REST API with JWT Auth
> Node.js · Express · JWT · bcrypt · PostgreSQL

Complete RESTful API with JWT authentication, role-based access control, and CRUD operations for users and posts. Interactive live demo where you can try every endpoint.

**Endpoints**: `POST /auth/login`, `POST /auth/register`, `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`

---

### ⚡ Edge AI & TinyML

#### [TinyML Gesture Classifier](https://moiz-ahmad-portfolio.vercel.app/projects/gesture-classifier.html) — On-device Neural Network
> TensorFlow Lite · Arduino Nano 33 BLE Sense · INT8 Quantization · Conv1D

Trained a Conv1D neural network on IMU data (119 frames × 3 axes), quantized it to INT8 (18KB), and deployed it on an Arduino Nano 33 BLE Sense. Classifies 6 hand gestures in 3.2ms with 97.4% accuracy — no WiFi, no cloud, fully on-device.

```
Model: Input(119×3) → Conv1D(16) → MaxPool → Conv1D(32) → MaxPool → Dense(64) → Softmax(6)
Size: 18KB (INT8)   Latency: 3.2ms   Accuracy: 97.4%
```

---

#### [FPGA Neural Network Accelerator](https://moiz-ahmad-portfolio.vercel.app/projects/nn-accelerator.html) — Systolic Array in Verilog
> Verilog HDL · Xilinx Artix-7 · Systolic Array · 50MHz

A 4×4 systolic array of Processing Elements (MAC units) implemented in Verilog HDL and synthesized on Xilinx Artix-7. Each PE computes `acc += data * weight` in a pipelined fashion. Achieves 12.8 GOPS for INT8 matrix multiply — the core of neural network inference.

```verilog
// Core PE: single multiply-accumulate
acc <= acc + $signed(data_in) * $signed(weight_in);
```

**Why it matters**: Most ML engineers only work in Python. Building the hardware underneath separates you from the crowd.

---

#### [Edge Anomaly Detector](https://moiz-ahmad-portfolio.vercel.app/projects/anomaly-detector.html) — Industrial IIoT on ESP32
> TensorFlow Lite · ESP32 · Autoencoder · ADXL345 Vibration Sensor

Autoencoder neural network that runs on an ESP32 to detect machine faults (bearing damage, rotor imbalance, shaft misalignment) from accelerometer vibration data. Uses reconstruction error as the anomaly score — no labeled fault data needed for training.

```
Detection Rate: 98.2%   False Positives: <1%   Latency: 12ms   Model: 34KB
```

---

#### [Keyword Spotter — Wake Word](https://moiz-ahmad-portfolio.vercel.app/projects/keyword-spotter.html) — "Hey Moiz" on STM32
> STM32F4 · MFCC · Depthwise Separable CNN · ARM CMSIS-DSP · I2S

Wake word detection running entirely on STM32F4. The audio pipeline: 16kHz PCM → pre-emphasis → STFT → 40-band mel filterbank → DCT → 40×49 MFCC spectrogram → DS-CNN (INT8). Recognizes 8 keywords with 95.3% accuracy in 8ms.

```
Pipeline: Mic → Pre-emphasis → STFT (25ms/10ms) → 40 Mel filters → DCT → DS-CNN
Latency: 8ms   Model: 22KB   Accuracy: 95.3%
```

---

### 🔌 Embedded & Hardware

#### [UART Transceiver](https://moiz-ahmad-portfolio.vercel.app/projects/uart-simulator.html) — Serial Protocol in Verilog
> Verilog HDL · 8N1 Frame Format · Configurable Baud Rate · Parity

Full UART transmitter and receiver in Verilog. Configurable baud rate (9600–115200), optional even/odd parity, 8 data bits, 1 stop bit. Simulated in Vivado. The interactive demo lets you type any text and watch each character serialize into bits with a live waveform.

---

#### [PWM Motor Controller](https://moiz-ahmad-portfolio.vercel.app/projects/pwm-controller.html) — Variable Speed Drive
> Verilog HDL · Arduino · PWM · H-Bridge Motor Driver

PWM generator in Verilog with configurable duty cycle (0–100%) and frequency (100Hz–16kHz). Uses a counter/comparator approach: `pwm_out = (counter < threshold)`. Demo shows live waveform, motor RPM simulation, and LED brightness control.

---

#### [RISC-V Pipelined Processor](https://github.com/BSCE22029/RISC-V-Microprocessor-pipelined) — 5-Stage Pipeline in Verilog
> Verilog HDL · RISC-V RV32I · Hazard Detection · Data Forwarding

5-stage pipelined RISC-V processor (IF → ID → EX → MEM → WB) with full hazard detection unit and data forwarding paths. Handles RAW hazards via forwarding and load-use hazards via stalling. Branch prediction with flush.

---

#### [4-Bit ALU Simulator](https://moiz-ahmad-portfolio.vercel.app/projects/alu-simulator.html) — Interactive ALU
> Verilog HDL · Vivado · ADD/SUB/AND/OR/XOR/NOT/SHL/SHR · CPU Flags

4-bit ALU with 8 operations, carry lookahead adder, and all CPU status flags (Zero, Carry, Negative, Overflow). Simulated in Vivado. The interactive demo lets you toggle bits and see the result update in real time.

---

#### [RFID Attendance System](https://github.com/BSCE22029/rfid-attendence-system-using-stm32) — STM32 + RC522
> C · STM32 · SPI · RC522 RFID · UART Logging

Automated attendance system using RC522 RFID reader connected to STM32 via SPI. Each card tap logs a timestamp over UART. Configurable card database stored in flash.

---

#### [Autonomous Robot Car](https://github.com/BSCE22029/line-following-and-obstacle-avoiding-robot-car) — Arduino
> C++ · Arduino · IR Sensors · Ultrasonic · L298N

Line-following robot with obstacle avoidance. IR sensors for line detection, HC-SR04 ultrasonic for obstacle detection. PID-like speed control for smooth turns.

---

### 🧠 AI & Machine Learning

#### [MNIST Digit Recognition](https://github.com/BSCE22029/MNIST_recognition) — 98%+ CNN
> Python · TensorFlow · CNN · Jupyter

CNN trained on MNIST achieving 98%+ accuracy. Architecture: Conv2D(32) → MaxPool → Conv2D(64) → MaxPool → Dense(128) → Softmax(10).

---

#### [Snake Game with CV Control](https://github.com/BSCE22029/Snake-game_using-cv) — Hand Gesture Control
> Python · OpenCV · MediaPipe · Game Dev

Classic Snake game controlled by hand gestures via webcam. Uses MediaPipe hand tracking to detect finger direction and translate it to game input in real time.

---

### 🛠️ Tools & Utilities

#### [Sorting Algorithm Visualizer](https://moiz-ahmad-portfolio.vercel.app/projects/sorting-visualizer.html) — DSA in Action
> JavaScript · Bubble · Insertion · Merge · Quick Sort

Animated sorting visualizer with comparison/swap counters, adjustable speed, and full Python + C++ implementations for each algorithm. Useful for DSA interview prep.

---

## Skills at a Glance

| Domain | Technologies |
|---|---|
| **Frontend** | React, Vite, TypeScript, Tailwind CSS, HTML/CSS |
| **Backend** | Node.js, Express, REST APIs, JWT, WebSockets |
| **Database** | PostgreSQL, Supabase, SQLite |
| **Embedded** | Arduino, STM32, ESP32, C/C++, FreeRTOS |
| **HDL** | Verilog, Xilinx Vivado, ModelSim, Artix-7 |
| **Edge AI** | TFLite, CMSIS-NN, MFCC, INT8 quantization |
| **AI/ML** | Python, TensorFlow, Keras, OpenCV, scikit-learn |
| **DevOps** | Git, GitHub, Vercel, AWS (Certified) |

---

## GitHub Stats

![Moiz's GitHub Stats](https://github-readme-stats.vercel.app/api?username=BSCE22029&show_icons=true&theme=midnight-purple&hide_border=true)
![Top Languages](https://github-readme-stats.vercel.app/api/top-langs/?username=BSCE22029&layout=compact&theme=midnight-purple&hide_border=true)

---

## Let's Work Together

I'm available for freelance projects and open to full-time opportunities in embedded systems, full-stack development, or Edge AI.

📧 **contact@atronm.com** · 💼 [LinkedIn](https://www.linkedin.com/in/moiz-ahmad-8922651a7/) · 🌐 [Portfolio](https://moiz-ahmad-portfolio.vercel.app)
