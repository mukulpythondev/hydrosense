
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// HC-SR04 pins
const byte TRIG_PIN = 5;
const byte ECHO_PIN = 6;

// OLED configuration
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(
  SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1
);

// HydroSense calibration (centimetres)
const float REFERENCE_DEPTH_CM = 100.0;
const float CAUTION_DEPTH_CM = 30.0;
const float HIGH_DEPTH_CM = 60.0;

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(3);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration =
    pulseIn(ECHO_PIN, HIGH, 30000UL);

  if (duration == 0) {
    return -1.0;
  }

  return duration * 0.0343 / 2.0;
}

void setup() {
  Serial.begin(9600);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  Wire.begin();

  if (!display.begin(
        SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("OLED not detected!");
    while (true) {
      delay(1000);
    }
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.println("HydroSense");
  display.setTextSize(1);
  display.println("Starting...");
  display.display();

  delay(1500);
}

void loop() {
  float distance = readDistanceCm();

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);

  display.println("HydroSense Monitor");
  display.println("------------------");

  if (distance < 0) {
    display.println("NO ECHO");
    display.println("Check sensor wiring");

    Serial.println("ERROR: No echo received");
  } else if (distance > REFERENCE_DEPTH_CM) {
    display.println("Out of reference");
    display.println("Check calibration");

    Serial.print("Distance: ");
    Serial.print(distance, 1);
    Serial.println(" cm - outside reference");
  } else {
    float depth = REFERENCE_DEPTH_CM - distance;

    const char* status;

    if (depth >= HIGH_DEPTH_CM) {
      status = "HIGH";
    } else if (depth >= CAUTION_DEPTH_CM) {
      status = "CAUTION";
    } else {
      status = "NORMAL";
    }

    display.print("Distance: ");
    display.print(distance, 1);
    display.println(" cm");

    display.print("Water depth: ");
    display.print(depth, 1);
    display.println(" cm");

    display.println();
    display.print("STATUS: ");
    display.println(status);

    Serial.print("Distance: ");
    Serial.print(distance, 1);
    Serial.print(" cm | Depth: ");
    Serial.print(depth, 1);
    Serial.print(" cm | Status: ");
    Serial.println(status);
  }

  display.display();
  delay(500);
}
