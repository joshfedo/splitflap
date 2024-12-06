#include <Arduino.h>

#define SENSOR_PIN 23
#define LED_PIN 2

void setup() {
  Serial.begin(230400);
  delay(1000);
  Serial.println("\nOH137 Transition Test");
  Serial.println("--------------------");
  
  pinMode(SENSOR_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  static unsigned long lastChangeTime = 0;
  static int lastState = -1;
  static int transitionCount = 0;
  
  int currentState = digitalRead(SENSOR_PIN);
  unsigned long now = millis();
  
  // Detect and report any state changes
  if (currentState != lastState) {
    transitionCount++;
    Serial.printf("Transition #%d at %lums - State changed to: %d\n", 
                 transitionCount, now, currentState);
    digitalWrite(LED_PIN, !currentState);
    lastState = currentState;
    lastChangeTime = now;
  }
  
  // Every 5 seconds, print status if no changes
  if (now - lastChangeTime >= 5000) {
    Serial.printf("No changes in 5s. Current state: %d\n", currentState);
    lastChangeTime = now;
  }
  
  delay(10);  // Debounce delay
}