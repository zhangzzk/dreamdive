# AI Social World Simulator
Design Document v0.1

---

# Vision

Build a **multi-agent social world simulator** where:

- humans are modeled as agents with drives, beliefs, and relationships
- the world evolves through interaction
- narratives emerge from social dynamics

The system should support two modes:

### Narrative Mode (B)
Players experience the world like an **interactive novel**.

### Simulation Mode (A)
The system behaves like a **social simulation sandbox**.

Both modes share the same underlying system.

---

# Core Principle

**State realism, narrative bias**

The simulator maintains a realistic evolving world state, while the narrative layer selectively presents events with dramatic significance.

State evolution:

S_t -> S_(t+1)

Narratives are interpretations of state changes, not scripted stories.

---

# System Architecture

Human / Society Simulator
↓
Narrative Interpreter
↓
Player Interface

---

# Human / Society Simulator

Responsible for:

- agents
- relationships
- beliefs
- resources
- decisions
- information flow

This layer does **not care about storytelling**.

It only evolves the world state.

---

# Narrative Interpreter

Responsible for detecting:

- rising conflicts
- alliance formation
- betrayals
- turning points

It selects which events become **scenes**.

This transforms simulation output into narrative.

---

# Player Interface

Responsible for:

- player perception of the world
- player actions
- narrative presentation

Players are treated as **agents inside the system**.

---

# Agent Model

Each agent contains several components.

## Identity

- name
- origin
- faction
- social class
- role
- location

Identity defines **structural constraints**.

---

## Traits (long-term personality)

Examples:

- ambition
- prudence
- impulsiveness
- empathy
- pride
- loyalty
- ruthlessness

Traits change slowly.

---

## Drives (motivations)

Examples:

- survival
- power
- status
- wealth
- belonging
- morality
- desire
- revenge

Actions maximize utility:

U(a) = Σ w_k g_k(a)

---

## Internal State (short-term)

Examples:

- mood
- stress
- fatigue
- confidence

These create behavioral variability.

---

## Beliefs

Agents act according to **perceived reality**, not objective reality.

Belief example:

- "Player might be dangerous"
- confidence: 0.6
- source: rumor

Beliefs allow:

- misinformation
- rumors
- paranoia
- strategic deception

---

## Relations

Relations are multi-dimensional:

R_ij =

- trust
- respect
- fear
- resentment
- obligation
- attraction

Stories often emerge from **changing relations**.

---

## Resources

Examples:

- money
- troops
- influence
- information access
- time

Resources constrain possible actions.

---

## Memory

Three types:

### Episodic
specific events

### Semantic
generalized judgments

### Strategic
plans and schemes

---

# World Model

## Time

Discrete steps.

Example phases:

- morning
- day
- night

or

- social phase
- political phase
- private phase

---

## Space

Graph of locations.

Nodes:
- cities
- houses
- camps
- taverns

Edges:
travel cost.

---

## Social Norms

Global parameters:

- honor culture strength
- hierarchy rigidity
- punishment for betrayal
- gender restrictions

These define **societal structure**.

---

## Public Opinion

Opinion field across society.

Example topics:

- legitimacy
- reputation
- loyalty

Opinion influences:

- recruitment
- trust
- risk

---

## Event Log

Each event contains:

- time
- location
- participants
- description
- consequences
- visibility

---

## Information Propagation

Not all agents learn events immediately.

Probability depends on:

- distance
- relationship
- communication channels
- social rank

---

# Simulation Loop

Each world step follows:

1. select active agents
2. perception update
3. belief update
4. goal selection
5. action generation
6. conflict resolution
7. memory update

---

# Narrative Layer

The narrative interpreter identifies:

- conflict arcs
- relationship tension
- turning points

It selects events and compresses them into **scenes**.

---

# Example Prototype

Three Kingdoms scenario.

Location:
Chaisang (柴桑)

Characters:

- Sun Quan
- Zhou Yu
- Lu Su
- Zhang Zhao
- Player

Simulation length:
3 days before Red Cliff.

Possible outcomes:

- alliance formation
- political conflict
- rumor spread
- trust shifts

---

# Long-Term Goal

A general **human social simulator** capable of supporting:

- historical worlds
- fantasy worlds
- modern societies

Narratives emerge from simulation dynamics.
