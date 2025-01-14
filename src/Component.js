export const Component = (config, registry, DataManager) => {
  const { entities, components, systems } = registry
  const deferredComponentRemovals = []

  let generation = 0
  const getGeneration = () => generation

  /**
   * Register a new component with the world.
   *
   * @example <caption>Register a flat component.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   x: 'float32',
   *   y: 'float32'
   * })
   *
   * @example <caption>Register a nested component.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   world: { x: 'float32', y: 'float32' }
   * })
   *
   * @example <caption>Register an enum component.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('STATE', {
   *   animation: ['IDLE', 'WALK', 'RUN']
   * })
   *
   * @example <caption>Register an array component.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POLYGON', {
   *   points: {
   *    x: [{ index: 'uint8', type: 'float32', length: 8 }],
   *    y: [{ index: 'uint8', type: 'float32', length: 8 }]
   *  }
   * })
   *
   * // The `length` param is optional and defaults to the max size of the `index` type.
   *
   * @memberof module:World
   * @param {string} name    - Name of component.
   * @param {Object} schema  - Data structure and types for component.
   * @returns {Object} DataManager for the component.
   */
  const registerComponent = (name, schema) => {
    if (Object.keys(components).length + 1 > config.maxComponentTypes) {
      throw new Error(
        `❌ Can not register component '${name}'. ` +
          `Max components '${config.maxComponentTypes}' reached.`
      )
    }
    components[name] = DataManager(config.maxEntities, schema)
    generation = components[name]._generationId
    return components[name]
  }

  /**
   * Get the component manager for a component
   *
   * @param {string} name
   * @private
   */
  const getComponentManager = name => {
    if (components[name] === undefined) {
      throw new Error(`❌ Component '${name}' is not registered.`)
    }
    return components[name]
  }

  /**
   * Add a registered component to an entity.
   *
   * @example <caption>Add a component to an entity.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   x: 'float32',
   *   y: 'float32'
   * })
   *
   * const eid = world.addEntity()
   * world.addComponent('POSITION', eid)
   *
   * @example <caption>Add a component to en entity with default values</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   x: 'float32',
   *   y: 'float32'
   * })
   *
   * const eid = world.addEntity()
   * world.addComponent('POSITION', eid, { x: 100, y: 100 })
   *
   * @memberof module:World
   * @param {string} name   - Name of the component,
   * @param {uint32} eid    - Entity id.
   * @param {object} values - Optional values to set upon component initialization.
   * @param {boolean} reset - Zero out the component values.
   */
  const addComponent = (name, eid, values = {}, reset = true) => {
    if (hasComponent(name, eid)) return

    const componentManager = getComponentManager(name)
    const { _generationId, _bitflag } = componentManager

    // Add bitflag to entity bitmask
    entities[_generationId][eid] |= _bitflag

    // Zero out each property value
    if (reset) componentManager._reset(eid)

    // Set values if any
    componentManager._set(eid, values)

    // Add to systems that match the entity bitmask
    for (const s in systems) {
      const system = systems[s]
      if (
        system.components.length &&
        system.checkComponent(componentManager) &&
        system.check(eid)
      ) {
        system.add(eid)
      }
    }
  }

  /**
   * Internal remove component. Actually removes the component.
   * @private
   */
  const commitComponentRemovals = () => {
    if (deferredComponentRemovals.length === 0) return

    for (let i = 0; i < deferredComponentRemovals.length; i += 2) {
      const name = deferredComponentRemovals[i]
      const eid = deferredComponentRemovals[i + 1]

      const componentManager = getComponentManager(name)
      const { _generationId, _bitflag } = componentManager

      if (!(entities[_generationId][eid] & _bitflag)) return

      // Remove flag from entity bitmask
      entities[_generationId][eid] &= ~_bitflag

      // Remove from systems that no longer match the entity bitmask
      for (const s in systems) {
        const system = systems[s]
        if (
          system.components.length &&
          system.checkComponent(componentManager) &&
          !system.check(eid)
        ) {
          system.remove(eid)
        }
      }
    }

    deferredComponentRemovals.length = 0
  }

  /**
   * Remove a component type from an entity.
   *
   * @example <caption>Remove a component deferred.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   x: 'float32',
   *   y: 'float32'
   * })
   *
   * const eid = world.addEntity()
   * world.addComponent('POSITION', eid, { x: 100, y: 100 }) // Component added
   * world.step()
   *
   * world.removeComponent('POSITION', eid)
   * world.step() // Component Removed
   *
   * @example <caption>Remove a component immediately.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   x: 'float32',
   *   y: 'float32'
   * })
   *
   * const eid = world.addEntity()
   * world.addComponent('POSITION', eid, { x: 100, y: 100 }) // Component added
   * world.step()
   *
   * world.removeComponent('POSITION', eid)
   * world.step() // Component removed after system has finished running
   *
   * @memberof module:World
   * @param {string} name       - Name of the component.
   * @param {uint32} eid        - Entity id.
   */
  const removeComponent = (name, eid) => {
    deferredComponentRemovals.push(name, eid)
  }

  /**
   * Removes all components from the given entity.
   *
   * @example <caption>Remove all components from an entity deferred.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   x: 'float32',
   *   y: 'float32'
   * })
   * world.registerComponent('VELOCITY', {
   *   vx: 'int8',
   *   vy: 'int8,
   * })
   *
   * const eid = world.addEntity()
   * world.addComponent('POSITION', eid, { x: 100, y: 100 }) // Component added
   * world.addComponent('VELOCITY', eid) // Component added
   *
   * world.removeAllComponent(eid)
   * world.step() // All components Removed
   *
   * @example <caption>Remove all components from an entity deferred.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   x: 'float32',
   *   y: 'float32'
   * })
   * world.registerComponent('VELOCITY', {
   *   vx: 'int8',
   *   vy: 'int8,
   * })
   *
   * const eid = world.addEntity()
   * world.addComponent('POSITION', eid, { x: 100, y: 100 }) // Component added
   * world.addComponent('VELOCITY', eid) // Component added
   *
   * world.removeAllComponent(eid, true) // All components Removed
   *
   * @memberof module:World
   * @param {uint32} eid - Entity id.
   */
  const removeAllComponents = eid => {
    Object.keys(components).forEach(name => {
      removeComponent(name, eid)
    })
  }

  /**
   * Check if an entity has the specified component.
   *
   * @example <caption>Check if entity has component.</caption>
   * import World from 'bitecs'
   *
   * const world = World()
   * world.registerComponent('POSITION', {
   *   x: 'float32',
   *   y: 'float32'
   * })
   *
   * const eid = world.addEntity()
   * world.hasComponent('POSITION', eid) // false
   *
   * world.addComponent('POSITION', eid, { x: 100, y: 100 })
   * world.hasComponent('POSITION', eid) // true
   *
   * @memberof module:World
   * @param {string} name - Component name.
   * @param {uint32} eid  - Entity id.
   * @returns {boolean} Wether or not the component exists on the entity.
   */
  const hasComponent = (name, eid) => {
    const componentManager = components[name]
    const { _generationId, _bitflag } = componentManager
    const mask = entities[_generationId][eid]
    return (mask & _bitflag) === _bitflag
  }

  return {
    getGeneration,
    registerComponent,
    addComponent,
    removeComponent,
    removeAllComponents,
    hasComponent,
    commitComponentRemovals
  }
}
